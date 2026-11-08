use serde_json::{json, Map, Value};

pub(super) fn policy(permission: Option<&str>, isolated: bool) -> &'static str {
    if isolated || matches!(permission, Some("plan" | "bypass")) {
        "never"
    } else {
        "on-request"
    }
}

pub(super) fn card(id: &Value, method: &str, params: &Value) -> (Value, Value) {
    let permissions = method == "item/permissions/requestApproval";
    let mut details = Map::new();
    for key in [
        "reason",
        "command",
        "cwd",
        "grantRoot",
        "additionalPermissions",
        "permissions",
        "networkApprovalContext",
    ] {
        if let Some(value) = params.get(key).filter(|value| !value.is_null()) {
            details.insert(key.into(), value.clone());
        }
    }
    let question = if permissions {
        "Codex: grant requested permissions?"
    } else if method == "item/fileChange/requestApproval" {
        "Codex: allow file changes?"
    } else {
        "Codex: allow command execution?"
    };
    let kind = if permissions {
        "permissions"
    } else if method == "item/fileChange/requestApproval" {
        "file"
    } else {
        "command"
    };
    let can_accept = params
        .get("availableDecisions")
        .and_then(Value::as_array)
        .map_or(true, |choices| {
            choices.iter().any(|choice| choice == "accept")
        });
    let mut choices = Map::new();
    if can_accept {
        let accepted = if permissions {
            json!({
                "permissions": params.get("permissions").cloned().unwrap_or(json!({})),
                "scope": "turn"
            })
        } else {
            json!({"decision": "accept"})
        };
        choices.insert("Allow once".into(), accepted);
    }
    let reject = if permissions {
        json!({"permissions": {}})
    } else {
        json!({"decision": "decline"})
    };
    choices.insert("Reject".into(), reject.clone());
    let options: Vec<Value> = ["Allow once", "Reject"]
        .into_iter()
        .filter(|label| choices.contains_key(*label))
        .map(|label| json!({"label":label}))
        .collect();
    (
        json!({
            "question": question,
            "header": "Codex approval",
            "multiSelect": false,
            "allowOther": false,
            "options": options,
            "approval": {"kind": kind, "details": details}
        }),
        json!({"rpcId": id, "question": question, "choices": choices, "reject": reject}),
    )
}

pub(super) fn answer(context: &Value, answers: Option<&Value>) -> Result<Value, String> {
    let result = match answers {
        None => context["reject"].clone(),
        Some(answers) => {
            let answers = answers.as_object().ok_or("Invalid Codex approval answer")?;
            let title = context["question"]
                .as_str()
                .ok_or("Missing approval question")?;
            if answers.len() != 1 {
                return Err("Choose exactly one approval option".into());
            }
            let label = answers
                .get(title)
                .and_then(Value::as_str)
                .ok_or("Missing approval choice")?;
            context["choices"]
                .get(label)
                .cloned()
                .ok_or("Unknown approval choice")?
        }
    };
    Ok(json!({"jsonrpc":"2.0","id":context["rpcId"],"result":result}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_preserves_restricted_runs() {
        for mode in [None, Some("auto"), Some("manual")] {
            assert_eq!(policy(mode, false), "on-request");
        }
        for mode in [Some("plan"), Some("bypass")] {
            assert_eq!(policy(mode, false), "never");
        }
        assert_eq!(policy(Some("auto"), true), "never");
    }
    #[test]
    fn command_and_file_approval_require_a_declared_user_choice() {
        for method in [
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
        ] {
            for id in [json!(7), json!("approval-7")] {
                let (card, context) = card(
                    &id,
                    method,
                    &json!({"command":"git commit","cwd":"/project","reason":"write metadata"}),
                );
                let title = card["question"].as_str().unwrap();
                assert_eq!(card["approval"]["details"]["command"], "git commit");
                assert!(!title.contains('{'));
                assert_eq!(card["allowOther"], false);
                let accepted = answer(&context, Some(&json!({title:"Allow once"}))).unwrap();
                assert_eq!(accepted["id"], id);
                assert_eq!(accepted["result"], json!({"decision":"accept"}));
                assert_eq!(
                    answer(&context, None).unwrap()["result"],
                    json!({"decision":"decline"})
                );
                assert_eq!(
                    answer(&context, Some(&json!({title:"Reject"}))).unwrap()["result"],
                    json!({"decision":"decline"})
                );
                assert!(answer(&context, Some(&json!({title:"acceptForSession"}))).is_err());
                assert!(answer(&context, Some(&json!({"another question":"Allow once"}))).is_err());
            }
        }
    }
    #[test]
    fn only_advertised_decisions_can_be_selected() {
        let (card, context) = card(
            &json!(2),
            "item/commandExecution/requestApproval",
            &json!({"availableDecisions":["decline"]}),
        );
        assert_eq!(card["options"].as_array().unwrap().len(), 1);
        assert!(answer(
            &context,
            Some(&json!({card["question"].as_str().unwrap():"Allow once"}))
        )
        .is_err());
    }
    #[test]
    fn malformed_answers_cannot_grant_permissions() {
        let (card, context) = card(
            &json!(5),
            "item/permissions/requestApproval",
            &json!({"permissions":{"network":{"enabled":true}}}),
        );
        let title = card["question"].as_str().unwrap();
        for invalid in [
            json!("Allow once"),
            json!([]),
            json!({}),
            json!({title:["Allow once"]}),
            json!({title:"Allow once","extra":"Allow once"}),
        ] {
            assert!(answer(&context, Some(&invalid)).is_err());
        }
    }

    #[test]
    fn permission_grant_is_exact_and_turn_scoped() {
        let requested = json!({"network":{"enabled":true},"fileSystem":{"read":["/shared/input"],"write":["/shared/output"]}});
        let (card, context) = card(
            &json!(3),
            "item/permissions/requestApproval",
            &json!({"permissions":requested}),
        );
        let title = card["question"].as_str().unwrap();
        assert_eq!(
            answer(&context, Some(&json!({title:"Allow once"}))).unwrap()["result"],
            json!({"permissions":requested,"scope":"turn"})
        );
        assert_eq!(
            answer(&context, None).unwrap()["result"],
            json!({"permissions":{}})
        );
    }
}
