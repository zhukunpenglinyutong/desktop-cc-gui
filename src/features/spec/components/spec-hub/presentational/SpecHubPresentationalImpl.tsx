// @ts-nocheck
import { Fragment as Ms, jsx as t, jsxs as n } from "react/jsx-runtime";
import {
  useCallback as I,
  useEffect as C,
  useMemo as P,
  useRef as W,
  useState as p,
} from "react";
import { createPortal as Ne } from "react-dom";
import { useTranslation as hc } from "react-i18next";
import { openUrl as bc } from "@tauri-apps/plugin-opener";
import Wt from "lucide-react/dist/esm/icons/arrow-right-circle";
import mi from "lucide-react/dist/esm/icons/badge-check";
import gc from "lucide-react/dist/esm/icons/calendar-days";
import hi from "lucide-react/dist/esm/icons/check-circle-2";
import fc from "lucide-react/dist/esm/icons/chevron-right";
import $n from "lucide-react/dist/esm/icons/chevrons-up-down";
import Rn from "lucide-react/dist/esm/icons/circle-dashed";
import vc from "lucide-react/dist/esm/icons/clock-3";
import kc from "lucide-react/dist/esm/icons/external-link";
import yc from "lucide-react/dist/esm/icons/file-code-2";
import Yt from "lucide-react/dist/esm/icons/file-pen-line";
import qt from "lucide-react/dist/esm/icons/file-search";
import Ac from "lucide-react/dist/esm/icons/folder-tree";
import Hc from "lucide-react/dist/esm/icons/git-branch";
import Tc from "lucide-react/dist/esm/icons/git-pull-request-arrow";
import Cc from "lucide-react/dist/esm/icons/heart-pulse";
import Fn from "lucide-react/dist/esm/icons/list-checks";
import it from "lucide-react/dist/esm/icons/maximize-2";
import Nc from "lucide-react/dist/esm/icons/message-circle";
import ot from "lucide-react/dist/esm/icons/minimize-2";
import xc from "lucide-react/dist/esm/icons/panel-right-close";
import Sc from "lucide-react/dist/esm/icons/panel-right-open";
import wc from "lucide-react/dist/esm/icons/plus";
import Ec from "lucide-react/dist/esm/icons/image-plus";
import bi from "lucide-react/dist/esm/icons/refresh-cw";
import gi from "lucide-react/dist/esm/icons/shield-alert";
import Ln from "lucide-react/dist/esm/icons/shield-check";
import xe from "lucide-react/dist/esm/icons/triangle-alert";
import Se from "lucide-react/dist/esm/icons/wrench";
import ct from "lucide-react/dist/esm/icons/x";
import J from "lucide-react/dist/esm/icons/x-circle";
import { Badge as _e } from "../../../../../components/ui/badge";
import {
  Tabs as fi,
  TabsContent as Xt,
  TabsList as vi,
  TabsTrigger as we,
} from "../../../../../components/ui/tabs";
import { subscribeAppServerEvents as ki } from "../../../../../services/events";
import {
  detectEngines as Pc,
  engineSendMessage as yi,
  engineSendMessageSync as In,
  getWorkspaceFiles as Dn,
  getActiveEngine as $c,
  pickImageFiles as Fc,
  sendUserMessage as Ai,
  startThread as Hi,
} from "../../../../../services/tauri";
import { Markdown as Lc } from "../../../../messages/components/Markdown";
import { ComposerAttachments as Ic } from "../../../../composer/components/ComposerAttachments";
import { useComposerImageDrop as Dc } from "../../../../composer/hooks/useComposerImageDrop";
import { EngineIcon as Ti } from "../../../../engine/components/EngineIcon";
import { useSpecHub as Mc } from "../../../hooks/useSpecHub";
import {
  buildSpecActions as Oc,
  buildSpecWorkspaceSnapshot as zc,
  evaluateOpenSpecChangePreflight as Bc,
  loadSpecArtifacts as _c,
  runSpecAction as Gc,
} from "../../../../../lib/spec-core/runtime";
import { normalizeSpecRootInput as Ci } from "../../../../../lib/spec-core/pathUtils";
import {
  Mn,
  Qc,
  Si,
  _n,
  Gn,
  Bn,
  nr,
  Pi,
  Ei,
  er,
  tr,
  xi,
  zn,
  Ee,
  Ge,
  jn,
  ne,
  wi,
  Vn,
  Ls,
  V,
  cr,
  rr,
  ur,
  pr,
  q,
  $i,
  dr,
  mr,
  hr,
  br,
  Ri,
  fr,
  vr,
  kr,
  yr,
  Ar,
  Tr,
  Cr,
  Nr,
  xr,
  Sr,
  lt,
  Fi,
  Li,
  Wn,
  Er,
  Pr,
  Ds,
  Mi,
  qn,
  $r,
  Un,
} from "./SpecHubPresentationalImpl.helpers";

function xl({
  workspaceId: a,
  workspaceName: i,
  files: c,
  directories: u,
  onBackToChat: k,
}) {
  const { t: e } = hc(),
    [g, N] = p("proposal"),
    [G, Z] = p("project"),
    [y, ae] = p("all"),
    [Jt, ut] = p(new Set()),
    [Zt, pt] = p(new Set()),
    dt = W(!1),
    Pe = W(!1),
    [ke, Qt] = p(!1),
    [changeContextMenu, setChangeContextMenu] = p(null),
    [$e, mt] = p(null),
    [ht, Q] = p("codex"),
    [S, Ae] = p("codex"),
    [Xn, Os] = p(["codex"]),
    [Kn, Jn] = p(!1),
    [Oi, Zn] = p(!1),
    [zi, bt] = p(null),
    [gt, Qn] = p(null),
    [ea, Re] = p(null),
    [ta, zs] = p(""),
    [He, sa] = p(!1),
    [Bs, ts] = p(null),
    [_s, Fe] = p(null),
    [Gs, js] = p(null),
    [ss, Vs] = p(""),
    [na, aa] = p(!0),
    [Us, Ws] = p(!1),
    [ft, me] = p("idle"),
    [ia, ns] = p("kickoff"),
    [Ys, as] = p("idle"),
    [Pt, qs] = p([]),
    [Te, oa] = p(null),
    [$t, Xs] = p(null),
    [ca, Ks] = p(0),
    [Bi, Js] = p(!1),
    [Rt, Zs] = p(!1),
    [ra, la] = p(null),
    [ua, Qs] = p(0),
    [en, pa] = p(!1),
    [is, tn] = p(!1),
    [da, ma] = p({}),
    [_i, Gi] = p(null),
    [ji, os] = p(!1),
    [Ft, cs] = p(!1),
    [Vi, sn] = p(!1),
    [Ui, Wi] = p(() => nr),
    [he, Ve] = p(() => Ge()),
    [be, Lt] = p(null),
    [ha, nn] = p(""),
    [vt, Ue] = p([]),
    [an, Le] = p(null),
    [ba, ge] = p(null),
    [rs, ga] = p(!1),
    [fa, It] = p(null),
    [va, ls] = p(!1),
    [us, ka] = p(!1),
    [Yi, on] = p(!1),
    [cn, ya] = p({}),
    [ps, Dt] = p(!0),
    [O, re] = p(_n),
    [qi, rn] = p(!1),
    [Mt, ln] = p(!1),
    [un, ds] = p(!1),
    [H, fe] = p(Gn),
    [Xi, pn] = p(!1),
    [Ot, dn] = p(!1),
    [Ie, zt] = p(() => jn(3)[2] ?? Ge()),
    [Ki, ms] = p(!1),
    [D, De] = p(Si),
    [Ji, Aa] = p(!1),
    [Bt, Ha] = p(!1),
    [w, Me] = p(Bn),
    [Zi, mn] = p(!1),
    [_t, hn] = p(!1),
    [ee, hs] = p(() => Ge()),
    [bs, Ta] = p(!1),
    Ca = W(null),
    gs = W(null),
    Gt = W(null),
    jt = W(null),
    We = W(null),
    changeContextMenuRef = W(null),
    Na = W(null),
    xa = W(null),
    Sa = W(null),
    wa = W(null),
    Ea = W(null),
    Pa = W(null),
    $a = W(null),
    Ra = W(null),
    Fa = W(null),
    La = W(null),
    Ia = W(null),
    Da = W(null),
    {
      snapshot: E,
      selectedChange: $,
      artifacts: z,
      actions: kt,
      timeline: Oe,
      gate: Ye,
      validationIssues: Ma,
      environmentMode: fs,
      isLoading: Oa,
      isRunningAction: ie,
      actionError: za,
      applyExecution: qe,
      isBootstrapping: Qi,
      bootstrapError: eo,
      isSavingProjectInfo: to,
      projectInfoError: so,
      isUpdatingTaskIndex: Ba,
      taskUpdateError: _a,
      customSpecRoot: X,
      isControlCenterCollapsed: ye,
      setControlCenterCollapsed: es,
      backlogChangeIds: changeBacklogIds,
      moveChangeToBacklog: addChangeToBacklog,
      removeChangeFromBacklog,
      refresh: yt,
      selectChange: bn,
      executeAction: Xe,
      executeBootstrap: no,
      persistProjectInfo: ao,
      updateTaskChecklistItem: io,
      setCustomSpecRoot: gn,
      switchMode: Ga,
    } = Mc({ workspaceId: a, files: c, directories: u }),
    oo = P(() => Ls(E.provider, e), [E.provider, e]),
    changeBacklogIdSet = P(() => new Set(changeBacklogIds), [changeBacklogIds]),
    At = P(
      () =>
        y === "blocked"
          ? E.changes.filter((s) => s.status === "blocked")
          : y === "archived"
          ? E.changes.filter((s) => s.status === "archived")
          : y === "backlog"
          ? E.changes.filter(
              (s) => s.status !== "archived" && changeBacklogIdSet.has(s.id)
            )
          : y === "active"
          ? E.changes.filter(
              (s) =>
                s.status !== "archived" &&
                s.status !== "blocked" &&
                !changeBacklogIdSet.has(s.id)
            )
          : E.changes,
      [y, E.changes, changeBacklogIdSet]
    ),
    fn = P(
      () => (y !== "all" ? [] : wi(At, e("specHub.archivedGroups.other"))),
      [y, At, e]
    ),
    vn = P(
      () => (y !== "archived" ? [] : wi(At, e("specHub.archivedGroups.other"))),
      [y, At, e]
    );
  C(() => {
    y === "all" &&
      ut((s) => {
        const o = fn.map((l) => l.key);
        if (o.length === 0) return (dt.current = !1), new Set();
        if (!dt.current) return (dt.current = !0), new Set(o);
        const r = new Set();
        return (
          o.forEach((l) => {
            s.has(l) && r.add(l);
          }),
          r
        );
      });
  }, [fn, y]),
    C(() => {
      y === "archived" &&
        pt((s) => {
          const o = vn.map((l) => l.key);
          if (o.length === 0) return (Pe.current = !1), new Set();
          if (!Pe.current) return (Pe.current = !0), new Set(o);
          const r = new Set();
          return (
            o.forEach((l) => {
              s.has(l) && r.add(l);
            }),
            r
          );
        });
    }, [vn, y]);
  const Ke = y === "all" ? fn : vn,
    ja = y === "all" ? Jt : Zt,
    kn = y === "all" || y === "archived",
    yn = Ke.length > 0 && Ke.every((s) => ja.has(s.key)),
    co = Ke.length === 0,
    ro = I(
      (s) => {
        if (y === "all") {
          ut((o) => {
            const r = new Set(o);
            return r.has(s) ? r.delete(s) : r.add(s), r;
          });
          return;
        }
        y === "archived" &&
          pt((o) => {
            const r = new Set(o);
            return r.has(s) ? r.delete(s) : r.add(s), r;
          });
      },
      [y]
    ),
    lo = I(() => {
      if (!kn || Ke.length === 0) return;
      const s = yn ? new Set() : new Set(Ke.map((o) => o.key));
      if (y === "all") {
        ut(s);
        return;
      }
      pt(s);
    }, [yn, y, Ke, kn]),
    openChangeContextMenu = I(
      (change, position) => {
        if (change.status === "archived") return;
        const menuWidth = 220,
          menuHeight = 56,
          viewportWidth = typeof window > "u" ? 1280 : window.innerWidth,
          viewportHeight = typeof window > "u" ? 720 : window.innerHeight;
        setChangeContextMenu({
          changeId: change.id,
          isBacklogMember: changeBacklogIdSet.has(change.id),
          x: Math.min(position.x, Math.max(12, viewportWidth - menuWidth - 12)),
          y: Math.min(
            position.y,
            Math.max(12, viewportHeight - menuHeight - 12)
          ),
        });
      },
      [changeBacklogIdSet]
    );
  C(() => {
    if (!changeContextMenu) return;
    const handlePointerDown = (event) => {
        changeContextMenuRef.current?.contains(event.target) ||
          setChangeContextMenu(null);
      },
      handleKeyDown = (event) => {
        event.key === "Escape" && setChangeContextMenu(null);
      };
    return (
      window.addEventListener("pointerdown", handlePointerDown),
      window.addEventListener("keydown", handleKeyDown),
      () => {
        window.removeEventListener("pointerdown", handlePointerDown),
          window.removeEventListener("keydown", handleKeyDown);
      }
    );
  }, [changeContextMenu]),
    C(() => {
      ma({}), setChangeContextMenu(null);
    }, [$?.id]);
  const le = P(
      () => E.changes.filter((s) => s.status !== "archived"),
      [E.changes]
    ),
    uo = Ye.status === "pass" ? "secondary" : "outline",
    po = Ye.status === "pass" ? Ln : Ye.status === "warn" ? xe : J,
    mo =
      E.provider === "openspec"
        ? "spec-hub-badge-provider-openspec border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]"
        : E.provider === "speckit"
        ? "spec-hub-badge-provider-speckit border-[#fde68a] bg-[#fffbeb] text-[#b45309]"
        : "spec-hub-badge-provider-unknown border-[#d1d5db] bg-[#f3f4f6] text-[#6b7280]",
    ho =
      E.supportLevel === "full"
        ? "spec-hub-badge-support-full border-[#a7f3d0] bg-[#ecfdf5] text-[#047857]"
        : E.supportLevel === "minimal"
        ? "spec-hub-badge-support-minimal border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]"
        : "spec-hub-badge-support-none border-[#d1d5db] bg-[#f3f4f6] text-[#6b7280]",
    ue = P(() => z.specs.sources ?? [], [z.specs.sources]),
    An = P(() => z.tasks.taskChecklist ?? [], [z.tasks.taskChecklist]),
    bo = P(() => $r(z.tasks.content, An), [z.tasks.content, An]),
    Ht = P(
      () =>
        ue.length === 0 ? null : ue.find((s) => s.path === $e) ?? ue[0] ?? null,
      [$e, ue]
    );
  C(() => {
    if (ue.length === 0) {
      mt(null);
      return;
    }
    (!$e || !ue.some((s) => s.path === $e)) && mt(ue[0]?.path ?? null);
  }, [$e, ue]),
    C(() => {
      if (le.length === 0) {
        Le(null);
        return;
      }
      Le((s) =>
        s && le.some((o) => o.id === s)
          ? s
          : $?.id && le.some((o) => o.id === $.id)
          ? $.id
          : le[0]?.id ?? null
      );
    }, [le, $?.id]),
    C(() => {
      It(null), ls(!1);
    }, [$?.id]),
    C(() => {
      Z("project"),
        Q("codex"),
        Ae("codex"),
        Os(["codex"]),
        Qn(null),
        bt(null),
        Re(null),
        ts(null),
        Fe(null),
        js(null),
        Vs(""),
        me("idle"),
        ns("kickoff"),
        as("idle"),
        qs([]),
        oa(null),
        Xs(null),
        Ks(0),
        aa(!0),
        Ws(!1),
        Js(!1),
        Zs(!1),
        os(!1),
        cs(!1),
        sn(!1),
        Ve(Ge()),
        Lt(null),
        nn(""),
        Ue([]),
        Le(null),
        ge(null),
        ga(!1),
        It(null),
        ls(!1),
        ka(!1),
        on(!1),
        ya({}),
        Dt(!0),
        re(_n),
        rn(!1),
        ln(!1),
        ds(!1),
        fe(Gn),
        pn(!1),
        dn(!1),
        ms(!1),
        zt(jn(3)[2] ?? Ge()),
        Me(Bn),
        mn(!1),
        hn(!1),
        (gs.current = null);
    }, [a]),
    C(() => {
      if (!He || !Te) return;
      const s = window.setInterval(() => {
        Ks((o) => o + 1);
      }, 1e3);
      return () => {
        window.clearInterval(s);
      };
    }, [Te, He]),
    C(() => {
      zs(X ?? "");
    }, [X]);
  const ve = E.provider === "unknown",
    go = ve || E.provider === "openspec",
    Tt = Oi || (ve ? Qi : to),
    Va = zi || (ve ? eo : so),
    fo = ve
      ? "openspec init --tools none [--force]"
      : "write openspec/project.md",
    ze = E.specRoot?.path ?? "openspec",
    vo = E.specRoot?.source === "custom",
    Ua = Ba !== null,
    ko = P(
      () => ["continue", "apply", "verify", "archive"].map((s) => ({ key: s })),
      []
    ),
    oe = $?.id ?? null,
    Be = oe ? `${oe}::${ze}` : null,
    Ct = Be ? cn[Be] ?? null : null,
    vs = Ct?.generatedAt ?? null,
    Wa = vs === null ? null : Math.max(0, Date.now() - vs),
    yo = Wa !== null && Wa > tr,
    Ao =
      vs !== null && ($?.updatedAt ?? 0) > 0 && ($?.updatedAt ?? 0) > vs + 1e3,
    Ho = yo || Ao;
  C(() => {
    if (!Be) {
      Dt(!1);
      return;
    }
    Dt(!!cn[Be]);
  }, [cn, Be]);
  const Nt = ie && Wn(ie) ? ie : null,
    Ya = P(() => kt.find((s) => s.key === "archive") ?? null, [kt]),
    qa = P(
      () =>
        oe
          ? Oe.find(
              (s) =>
                s.action === "archive" && s.command.includes(oe) && !s.success
            ) ?? null
          : null,
      [oe, Oe]
    ),
    Ce = P(
      () =>
        oe
          ? Oe.find(
              (s) =>
                s.kind === "action" && Wn(s.action) && s.command.includes(oe)
            ) ?? null
          : null,
      [oe, Oe]
    ),
    To = Ce && Wn(Ce.action) ? Ce.action : null,
    Je = Nt ?? To ?? _i,
    te = Nt ? "running" : Ce ? (Ce.success ? "success" : "failed") : "idle",
    Ze = Ce?.output ?? "",
    pe = P(() => Pr(Ze), [Ze]),
    ks = P(() => Er(Ze), [Ze]),
    Co = is ? Ze : ks.text,
    No = e(Je ? `specHub.action.${Je}` : "specHub.placeholder.notAvailable"),
    xo = e(`specHub.aiTakeover.status.${te}`),
    So = Ce
      ? new Date(Ce.at).toLocaleTimeString()
      : e("specHub.placeholder.notAvailable"),
    Hn = Je === "continue" ? "apply" : Je === "apply" ? "verify" : null,
    Qe = P(() => (Hn ? kt.find((s) => s.key === Hn) ?? null : null), [kt, Hn]),
    Tn = P(
      () =>
        oe
          ? Oe.find((s) => s.kind === "validate" && s.command.includes(oe)) ??
            null
          : null,
      [oe, Oe]
    ),
    Cn = P(
      () => (Tn ? { ran: !0, success: Tn.success } : { ran: !1, success: !1 }),
      [Tn]
    ),
    Xa = P(() => Ya?.blockers ?? [], [Ya]),
    Ka = P(() => Xa.filter((s) => xr(s)), [Xa]),
    ys = P(() => {
      const s = qa?.output?.trim();
      return s && Sr(s) ? s : null;
    }, [qa]),
    wo = Ka.length > 0 || !!ys,
    Eo =
      E.provider === "openspec" &&
      !!oe &&
      $?.status !== "archived" &&
      Cn.ran &&
      wo,
    As = Mn.indexOf(ia),
    Ja = P(() => {
      if (!Te) return null;
      const s = $t ?? Te + ca * 1e3;
      return Math.max(0, s - Te);
    }, [$t, Te, ca]),
    Za = P(
      () => (te !== "running" || !ra ? null : Math.max(0, ua * 1e3)),
      [ra, ua, te]
    ),
    Qa = Za === null ? null : lt(Za),
    ei = Ja === null ? null : lt(Ja),
    Nn = qe.status !== "idle",
    v = Nn ? qe : Ui,
    Po = v.status !== "idle",
    $o = e(`specHub.applyExecution.status.${v.status}`),
    Ro = e(`specHub.applyExecution.phase.${v.phase}`),
    Hs = Po && !ji,
    et = w.status === "running",
    Ts = va || ie !== null || et,
    tt = Ts || Yi,
    ti = O.status !== "idle" && !qi,
    Fo = e(`specHub.continueAiEnhancement.status.${O.status}`),
    Lo = e(`specHub.continueAiEnhancement.phase.${O.phase}`),
    xn = H.status !== "idle" && !Xi,
    Io = e(`specHub.autoCombo.status.${H.status}`),
    Do = e(`specHub.autoCombo.phase.${H.phase}`),
    Mo = w.status !== "idle" && !Zi,
    Oo = e(`specHub.proposal.status.${w.status}`),
    zo = e(`specHub.proposal.phase.${w.phase}`),
    Bo =
      w.mode === "append"
        ? e("specHub.proposal.modeAppend")
        : e("specHub.proposal.modeCreate"),
    Sn = D.status !== "idle" && !Ji,
    _o = e(`specHub.verifyAutoComplete.status.${D.status}`),
    Go = e(`specHub.verifyAutoComplete.phase.${D.phase}`),
    si = v.startedAt
      ? lt(Math.max(0, (v.finishedAt ?? Date.now()) - v.startedAt))
      : null,
    ni = w.startedAt
      ? lt(Math.max(0, (w.finishedAt ?? Date.now()) - w.startedAt))
      : null,
    ai = D.startedAt
      ? lt(Math.max(0, (D.finishedAt ?? Date.now()) - D.startedAt))
      : null,
    ii = O.startedAt
      ? lt(Math.max(0, (O.finishedAt ?? Date.now()) - O.startedAt))
      : null,
    oi = H.startedAt
      ? lt(Math.max(0, (H.finishedAt ?? Date.now()) - H.startedAt))
      : null,
    Cs = P(
      () => ({ changedFiles: 0, tests: 0, checks: 0, completedTasks: 0 }),
      []
    ),
    jo = P(
      () => ({
        changedFiles: v.changedFiles.length,
        tests: v.tests.length,
        checks: v.checks.length,
        completedTasks: v.completedTaskIndices.length,
      }),
      [
        v.changedFiles.length,
        v.tests.length,
        v.checks.length,
        v.completedTaskIndices.length,
      ]
    ),
    Vo = Cs,
    Uo = P(
      () => ({
        changedFiles: H.changedFiles.length,
        tests: H.tests.length,
        checks: H.checks.length,
        completedTasks: H.completedTaskIndices.length,
      }),
      [
        H.changedFiles.length,
        H.tests.length,
        H.checks.length,
        H.completedTaskIndices.length,
      ]
    ),
    ci = un && ti && Hs,
    Vt = P(
      () => (ci ? Fi({ continuePosition: ee, applyPosition: he }) : null),
      [ee, he, ci]
    ),
    Ut = P(
      () => (Hs && xn ? Fi({ continuePosition: he, applyPosition: Ie }) : null),
      [he, Ie, Hs, xn]
    ),
    xt = I(
      (s, o) =>
        n("strong", {
          className: `is-${s} spec-hub-status-value`,
          children: [
            s === "running"
              ? t(bi, { size: 12, "aria-hidden": !0, className: "spin" })
              : null,
            t("span", { children: o }),
          ],
        }),
      []
    ),
    St = I(
      (s) =>
        n("p", {
          className: "spec-hub-feedback-metrics",
          children: [
            e("specHub.applyExecution.changedFiles", { count: s.changedFiles }),
            " \xB7 ",
            e("specHub.applyExecution.tests", { count: s.tests }),
            " \xB7 ",
            e("specHub.applyExecution.checks", { count: s.checks }),
            " \xB7 ",
            e("specHub.applyExecution.completedTasks", {
              count: s.completedTasks,
            }),
          ],
        }),
      [e]
    ),
    wt = I(
      (s) =>
        n("div", {
          className: "spec-hub-command-preview",
          children: [
            t("span", {
              children: e("specHub.applyExecution.changedFilesTitle"),
            }),
            t("code", {
              children:
                s.length > 0
                  ? s.join(`
`)
                  : e("specHub.applyExecution.changedFilesEmpty"),
            }),
          ],
        }),
      [e]
    ),
    M = I((s) => {
      s && (s.scrollTop = s.scrollHeight);
    }, []);
  C(() => {
    M(Na.current);
  }, [w.streamOutput, M]),
    C(() => {
      M(xa.current);
    }, [w.logs, M]),
    C(() => {
      M(Sa.current);
    }, [O.streamOutput, M]),
    C(() => {
      M(wa.current);
    }, [O.logs, M]),
    C(() => {
      M(Ea.current);
    }, [D.streamOutput, M]),
    C(() => {
      M(Pa.current);
    }, [D.logs, M]),
    C(() => {
      M($a.current);
    }, [v.executionOutput, M]),
    C(() => {
      M(Ra.current);
    }, [v.logs, M]),
    C(() => {
      M(Fa.current);
    }, [ss, M]),
    C(() => {
      M(La.current);
    }, [Pt, M]),
    C(() => {
      M(Ia.current);
    }, [H.streamOutput, M]),
    C(() => {
      M(Da.current);
    }, [H.logs, M]),
    C(() => {
      H.status !== "idle" &&
        ((H.phase !== "remediate" && H.phase !== "verify") ||
          fe((s) => {
            if (s.status === "idle") return s;
            const o = v.changedFiles,
              r = v.tests,
              l = v.checks,
              b = v.completedTaskIndices,
              d = v.executionOutput || s.streamOutput;
            return s.streamOutput === d &&
              s.changedFiles.length === o.length &&
              s.tests.length === r.length &&
              s.checks.length === l.length &&
              s.completedTaskIndices.length === b.length &&
              s.changedFiles.every((m, f) => m === o[f]) &&
              s.tests.every((m, f) => m === r[f]) &&
              s.checks.every((m, f) => m === l[f]) &&
              s.completedTaskIndices.every((m, f) => m === b[f])
              ? s
              : {
                  ...s,
                  streamOutput: d,
                  changedFiles: [...o],
                  tests: [...r],
                  checks: [...l],
                  completedTaskIndices: [...b],
                };
          }));
    }, [
      v.changedFiles,
      v.checks,
      v.completedTaskIndices,
      v.executionOutput,
      v.tests,
      H.phase,
      H.status,
    ]);
  const Wo = P(
      () =>
        Pt.length === 0
          ? ""
          : Pt.map((s) => {
              const o = new Date(s.at).toLocaleTimeString(),
                r = e(`specHub.aiTakeover.phase.${s.phase}`),
                l = e(`specHub.aiTakeover.logLevel.${s.level}`);
              return `[${o}] [${l}] [${r}] ${s.message}`;
            }).join(`
`),
      [Pt, e]
    ),
    Yo =
      (ft !== "idle" ||
        !!Te ||
        !!$t ||
        !!Bs ||
        !!_s ||
        !!Gs ||
        !!ss ||
        Pt.length > 0) &&
      !Bi,
    Ns = P(() => new Set(Xn), [Xn]),
    qo = P(
      () =>
        $i.map((s) => {
          const o = Ns.has(s),
            r = o
              ? q(s)
              : `${q(s)} \xB7 ${e("specHub.environment.notInstalled")}`;
          return { engine: s, installed: o, label: r };
        }),
      [Ns, e]
    ),
    Xo = P(
      () =>
        $i.map((s) => {
          const o = Ns.has(s),
            r = o
              ? q(s)
              : `${q(s)} \xB7 ${e("specHub.environment.notInstalled")}`;
          return { engine: s, installed: o, label: r };
        }),
      [Ns, e]
    ),
    xs = I(() => {
      const s = Ee();
      Ve(ne(Ge(s.width), s));
    }, []),
    Et = I(() => {
      const s = Ee();
      Ve((o) => ne(o, s));
    }, []),
    st = I(() => {
      const s = Ee();
      hs(ne(Ge(s.width), s));
    }, []),
    Ss = I(() => {
      const s = Ee();
      hs((o) => ne(o, s));
    }, []),
    ws = I(() => {
      const s = Ee();
      zt((o) => ne(o, s));
    }, []),
    ri = I(() => {
      const [s, o, r] = jn(3),
        l = s ?? Ge(),
        b = o ?? l,
        d = r ?? b;
      return hs(l), Ve(b), zt(d), [l, b, d];
    }, []);
  C(() => {
    if (!Nn) {
      gs.current = null;
      return;
    }
    const s = qe.startedAt ?? null;
    s &&
      s !== gs.current &&
      ((gs.current = s), os(!1), cs(!1), un ? Et() : xs());
  }, [qe.startedAt, Et, un, xs, Nn]),
    C(() => {
      qe.status !== "idle" && Wi(qe);
    }, [qe]),
    C(() => {
      const s = () => {
        Et(), Ss(), ws();
      };
      return (
        window.addEventListener("resize", s),
        () => {
          window.removeEventListener("resize", s);
        }
      );
    }, [Ss, Et, ws]),
    C(() => {
      Et(), Ss(), ws();
    }, [ws, Ss, Et, ke, ye]),
    C(
      () => () => {
        Gt.current?.(), (Gt.current = null);
      },
      []
    ),
    C(
      () => () => {
        jt.current?.(), (jt.current = null);
      },
      []
    ),
    C(
      () => () => {
        We.current?.(), (We.current = null);
      },
      []
    );
  const Ko = I(
      (s) => {
        if (s.button !== 0 || s.target?.closest("button")) return;
        s.preventDefault();
        const r = s.clientX - he.x,
          l = s.clientY - he.y;
        sn(!0);
        const b = (m) => {
            Ve(ne({ x: m.clientX - r, y: m.clientY - l }));
          },
          d = () => {
            window.removeEventListener("pointermove", b),
              window.removeEventListener("pointerup", h);
          },
          h = () => {
            sn(!1), d(), (Gt.current = null);
          };
        Gt.current?.(),
          (Gt.current = d),
          window.addEventListener("pointermove", b),
          window.addEventListener("pointerup", h);
      },
      [he.x, he.y]
    ),
    Es = I(
      (s) => {
        if (s.button !== 0 || s.target?.closest("button")) return;
        s.preventDefault();
        const r = s.clientX - ee.x,
          l = s.clientY - ee.y;
        Ta(!0);
        const b = (m) => {
            hs(ne({ x: m.clientX - r, y: m.clientY - l }));
          },
          d = () => {
            window.removeEventListener("pointermove", b),
              window.removeEventListener("pointerup", h);
          },
          h = () => {
            Ta(!1), d(), (jt.current = null);
          };
        jt.current?.(),
          (jt.current = d),
          window.addEventListener("pointermove", b),
          window.addEventListener("pointerup", h);
      },
      [ee.x, ee.y]
    ),
    Jo = I(
      (s) => {
        if (s.button !== 0 || s.target?.closest("button")) return;
        s.preventDefault();
        const r = s.clientX - Ie.x,
          l = s.clientY - Ie.y;
        ms(!0);
        const b = (m) => {
            zt(ne({ x: m.clientX - r, y: m.clientY - l }));
          },
          d = () => {
            window.removeEventListener("pointermove", b),
              window.removeEventListener("pointerup", h);
          },
          h = () => {
            ms(!1), d(), (We.current = null);
          };
        We.current?.(),
          (We.current = d),
          window.addEventListener("pointermove", b),
          window.addEventListener("pointerup", h);
      },
      [Ie.x, Ie.y]
    );
  C(() => {
    const s = Ca.current;
    !s && Nt && (la(Date.now()), Qs(0), Gi(Nt), pa(!1), tn(!1)),
      s && !Nt && (la(null), Qs(0)),
      (Ca.current = ie);
  }, [ie, Nt]),
    C(() => {
      if (te === "running") {
        const s = window.setInterval(() => {
          Qs((o) => o + 1);
        }, 1e3);
        return () => {
          window.clearInterval(s);
        };
      }
    }, [te]),
    C(() => {
      tn(!1);
    }, [Ce?.id]);
  const Zo = (s) => {
      if (ft === "success") return "done";
      const o = Mn.indexOf(s);
      return ft === "failed"
        ? o < As
          ? "done"
          : o === As
          ? "failed"
          : "pending"
        : ft === "running"
        ? o < As
          ? "done"
          : o === As
          ? "current"
          : "pending"
        : "pending";
    },
    j = (s, o, r) => {
      qs((l) => [
        ...l,
        {
          id: `ai-log-${Date.now()}-${l.length}`,
          at: Date.now(),
          phase: s,
          level: o,
          message: r,
        },
      ]);
    },
    li = I(
      async (s) => {
        if (!a)
          return {
            archived: !1,
            ready: !1,
            blockers: [e("specHub.runtime.selectWorkspaceFirst")],
          };
        let o = c,
          r = u;
        try {
          const f = await Dn(a);
          (o = f.files), (r = f.directories);
        } catch {}
        const l = await zc({
            workspaceId: a,
            files: o,
            directories: r,
            mode: fs,
            customSpecRoot: X,
          }),
          b = l.changes.find((f) => f.id === s) ?? null;
        if (!b)
          return {
            archived: !1,
            ready: !1,
            blockers: [e("specHub.runtime.selectChangeFirst")],
          };
        const d = await _c({ workspaceId: a, change: b, customSpecRoot: X }),
          m = Oc({
            change: b,
            supportLevel: l.supportLevel,
            provider: l.provider,
            environment: l.environment,
            verifyState: Cn,
            taskProgress: d.tasks.taskProgress,
          }).find((f) => f.key === "archive");
        return m
          ? {
              archived: b.status === "archived",
              ready: m.available,
              blockers: m.blockers,
            }
          : {
              archived: b.status === "archived",
              ready: !1,
              blockers: [e("specHub.aiTakeover.archiveActionMissing")],
            };
      },
      [X, u, fs, c, e, Cn, a]
    );
  C(() => {
    if (!a) return;
    let s = !1;
    return (
      Jn(!0),
      Promise.all([Pc(), $c()])
        .then(([o, r]) => {
          if (s) return;
          const l = [];
          for (const d of o)
            d.installed && Vn(d.engineType) && l.push(d.engineType);
          const b = l.length > 0 ? l : ["codex"];
          Os(b),
            Vn(r) && b.includes(r)
              ? (Q(r), Ae(r))
              : (Q(b[0] ?? "codex"), Ae(b[0] ?? "codex"));
        })
        .catch(() => {
          s || (Os(["codex"]), Q("codex"), Ae("codex"));
        })
        .finally(() => {
          s || Jn(!1);
        }),
      () => {
        s = !0;
      }
    );
  }, [a]);
  const Qo = async () => {
      if ((Re(null), bt(null), !!a)) {
        Zn(!0);
        try {
          const s = pr({
              workspaceName: i,
              files: c,
              directories: u,
              provider: E.provider,
            }),
            o = await In(a, {
              text: s,
              engine: ht,
              accessMode: "read-only",
              continueSession: !1,
            }),
            r = Un(o.text);
          if (!r) throw new Error(e("specHub.bootstrap.invalidAgentResponse"));
          const l = ur({ payload: r, files: c, provider: E.provider });
          Qn(l),
            (ve ? await no(l) : await ao(l)) &&
              Re(
                e(
                  ve
                    ? "specHub.bootstrap.bootstrapSuccess"
                    : "specHub.bootstrap.projectInfoSaved"
                )
              );
        } catch (s) {
          bt(s instanceof Error ? s.message : String(s));
        } finally {
          Zn(!1);
        }
      }
    },
    Ps = I((s, o) => {
      Me((r) => ({
        ...r,
        logs: [...r.logs, `[${new Date().toLocaleTimeString()}] [${s}] ${o}`],
      }));
    }, []),
    $s = I(
      (s, o) =>
        s === "count"
          ? e("specHub.proposal.imageCountExceeded", { count: zn })
          : s === "size"
          ? e("specHub.proposal.imageTooLarge", { size: o ?? Ri(xi) })
          : e("specHub.proposal.imageUnsupported"),
      [e]
    ),
    wn = I((s) => {
      const o = s.trim();
      if (!o) return { ok: !1, reason: "type" };
      if (o.startsWith("data:")) {
        const r = hr(o);
        if (!Qc.includes(r)) return { ok: !1, reason: "type" };
        const l = br(o);
        return l > xi ? { ok: !1, reason: "size", value: Ri(l) } : { ok: !0 };
      }
      return /^https?:\/\//i.test(o)
        ? { ok: !0 }
        : mr(o)
        ? { ok: !0 }
        : { ok: !1, reason: "type" };
    }, []),
    En = I(
      (s) => {
        if (s.length === 0) return;
        const o = [...vt];
        let r = null;
        for (const l of s.map((b) => b.trim()).filter(Boolean)) {
          if (o.includes(l)) continue;
          if (o.length >= zn) {
            r = $s("count");
            break;
          }
          const b = wn(l);
          if (!b.ok) {
            r = $s(b.reason, b.value);
            continue;
          }
          o.push(l);
        }
        Ue(o), ge(r);
      },
      [$s, vt, wn]
    ),
    ec = I((s) => {
      Ue((o) => o.filter((r) => r !== s)), ge(null);
    }, []),
    tc = I(async () => {
      const s = await Fc();
      En(s);
    }, [En]),
    {
      dropTargetRef: sc,
      isDragOver: nc,
      handleDragOver: ac,
      handleDragEnter: ic,
      handleDragLeave: oc,
      handleDrop: cc,
      handlePaste: rc,
    } = Dc({ disabled: !be || et, onAttachImages: En }),
    Rs = I(
      async (s) => {
        if (!a) throw new Error(e("specHub.runtime.selectWorkspaceFirst"));
        const o = (d) =>
            new Promise((h, m) => {
              const f = new Set([d]);
              let R = "",
                U = 0,
                K = !1;
              const ce = window.setTimeout(() => {
                  K ||
                    ((K = !0),
                    A(),
                    m(new Error(e("specHub.proposal.turnTimeout"))));
                }, 900 * 1e3),
                B = (L) => {
                  K || ((K = !0), window.clearTimeout(ce), A(), L());
                },
                A = ki((L) => {
                  if (L.workspace_id !== a) return;
                  const se = L.message,
                    _ = String(se.method ?? ""),
                    x = se.params ?? {},
                    nt = x.turn,
                    Y = String(
                      x.threadId ??
                        x.thread_id ??
                        nt?.threadId ??
                        nt?.thread_id ??
                        ""
                    );
                  if (_ === "thread/started" && Y && f.has(Y)) {
                    const T = String(x.sessionId ?? x.session_id ?? ""),
                      F = String(x.engine ?? "").toLowerCase();
                    if (
                      T &&
                      T !== "pending" &&
                      (F === "claude" || F === "opencode")
                    ) {
                      const at = `${F}:${T}`;
                      f.has(at) ||
                        (f.add(at),
                        s.onLog(
                          e("specHub.proposal.logThreadBound", { threadId: at })
                        ));
                    }
                    return;
                  }
                  if (!(!Y || !f.has(Y))) {
                    if (_ === "item/agentMessage/delta") {
                      const T = String(x.delta ?? "");
                      if (!T) return;
                      (R += T), s.onDelta(T);
                      return;
                    }
                    if (_ === "item/started") {
                      const T = x.item ?? {},
                        F = String(T.tool ?? T.id ?? "").trim();
                      F &&
                        s.onLog(
                          e("specHub.proposal.logToolStarted", { tool: F })
                        );
                      return;
                    }
                    if (_ === "item/completed") {
                      const T = x.item ?? {},
                        F = String(T.tool ?? T.id ?? "").trim();
                      F &&
                        s.onLog(
                          e("specHub.proposal.logToolCompleted", { tool: F })
                        );
                      return;
                    }
                    if (_ === "processing/heartbeat") {
                      (U += 1),
                        (U === 1 || U % 6 === 0) &&
                          s.onLog(
                            e("specHub.proposal.logHeartbeat", { seconds: U })
                          );
                      return;
                    }
                    if (_ === "turn/error" || _ === "error") {
                      const T =
                        x.error && typeof x.error == "object"
                          ? String(x.error.message ?? "")
                          : String(x.error ?? "");
                      B(() =>
                        m(
                          new Error(
                            T.trim() || e("specHub.proposal.executionFailed")
                          )
                        )
                      );
                      return;
                    }
                    if (_ === "turn/completed") {
                      const T = Mi(x),
                        F = R.trim() || T.trim();
                      B(() => h(F));
                    }
                  }
                });
            }),
          r = async () => {
            let d = 0;
            const h = window.setInterval(() => {
              (d += 1),
                (d === 1 || d % 5 === 0) &&
                  s.onLog(
                    e("specHub.proposal.logSyncHeartbeat", { seconds: d })
                  );
            }, 1e3);
            try {
              return (
                (
                  await In(a, {
                    text: s.prompt,
                    engine: s.engine,
                    accessMode: s.accessMode ?? "full-access",
                    continueSession: !1,
                    images: s.images ?? null,
                    customSpecRoot: X,
                  })
                )?.text ?? ""
              );
            } finally {
              window.clearInterval(h);
            }
          };
        if (s.engine === "codex") {
          const d = await Hi(a),
            h = Ds(d);
          if (h) {
            s.onLog(e("specHub.proposal.logThreadBound", { threadId: h }));
            const m = o(h);
            return (
              await Ai(a, h, s.prompt, {
                accessMode: s.accessMode ?? "full-access",
                images: s.images,
                customSpecRoot: X,
              }),
              m
            );
          }
          return s.onLog(e("specHub.proposal.logFallbackSync")), r();
        }
        const l = await yi(a, {
            text: s.prompt,
            engine: s.engine,
            accessMode: s.accessMode ?? "full-access",
            continueSession: !1,
            images: s.images ?? null,
            customSpecRoot: X,
          }),
          b = Ds(l);
        return b
          ? (s.onLog(e("specHub.proposal.logThreadBound", { threadId: b })),
            o(b))
          : (s.onLog(e("specHub.proposal.logFallbackSync")), r());
      },
      [X, e, a]
    ),
    ui = I(
      (s) => {
        if ((ge(null), nn(""), Ue([]), Lt(s), s === "append")) {
          if ($?.id && le.some((o) => o.id === $.id)) {
            Le($.id);
            return;
          }
          Le(le[0]?.id ?? null);
          return;
        }
        Le($?.id ?? le[0]?.id ?? null);
      },
      [le, $?.id]
    ),
    Fs = I(
      (s) => (
        os(!1),
        cs(!1),
        s?.positionOverride
          ? Ve(ne(s.positionOverride))
          : s?.skipPositionReset || xs(),
        Xe("apply", {
          applyMode: "execute",
          applyExecutor: S,
          applyContinueBrief: s?.continueBriefOverride ?? Ct,
          applyUseContinueBrief: s?.forceUseContinueBrief ?? ps,
          ignoreAvailability: s?.ignoreAvailability ?? !1,
        })
      ),
      [S, ps, Ct, Xe, xs, Ve]
    ),
    Pn = I(
      async (s) => {
        if (s === "continue") {
          ds(!1);
          const o = await Xe(s);
          if (!us || !$ || !Be || !o?.success) return o;
          const r = a,
            l = $;
          if (!r || !l) return o;
          const b = Date.now();
          rn(!1), ln(!1);
          const [, d, h] = ri();
          re({
            ..._n,
            status: "running",
            phase: "analysis-dispatch",
            executor: S,
            startedAt: b,
            logs: [
              `[${new Date().toLocaleTimeString()}] ${e(
                "specHub.continueAiEnhancement.logDispatch",
                { engine: q(S) }
              )}`,
            ],
          }),
            on(!0);
          try {
            re((A) => ({ ...A, phase: "analysis-execution" }));
            const m = await Rs({
                prompt: Tr({
                  workspaceName: i,
                  changeId: l.id,
                  specRoot: ze,
                  continueOutput: o.output,
                }),
                engine: S,
                accessMode: "read-only",
                onDelta: (A) => {
                  re((L) => ({ ...L, streamOutput: `${L.streamOutput}${A}` }));
                },
                onLog: (A) => {
                  re((L) => ({
                    ...L,
                    logs: [
                      ...L.logs,
                      `[${new Date().toLocaleTimeString()}] ${A}`,
                    ],
                  }));
                },
              }),
              f = Date.now(),
              R = Cr(m, { changeId: l.id, specRoot: ze, generatedAt: f });
            ya((A) => ({ ...A, [Be]: R })),
              Dt(!0),
              re((A) => ({
                ...A,
                status: "running",
                phase: "analysis-finalize",
                summary: R.summary,
                finalOutput: m,
                error: null,
                logs: [
                  ...A.logs,
                  `[${new Date().toLocaleTimeString()}] ${e(
                    "specHub.continueAiEnhancement.logFinished"
                  )}`,
                ],
              })),
              re((A) => ({
                ...A,
                phase: "apply-dispatch",
                logs: [
                  ...A.logs,
                  `[${new Date().toLocaleTimeString()}] ${e(
                    "specHub.continueAiEnhancement.logAutoApplyDispatch",
                    { engine: q(S) }
                  )}`,
                ],
              })),
              ds(!0),
              re((A) => ({ ...A, phase: "apply-execution" }));
            const K = !!(
              await Fs({
                continueBriefOverride: R,
                forceUseContinueBrief: !0,
                ignoreAvailability: !0,
                positionOverride: d ?? null,
                skipPositionReset: !0,
              })
            )?.success;
            pn(!1),
              dn(!1),
              h && zt(ne(h)),
              fe({
                ...Gn,
                status: "running",
                phase: "audit",
                executor: S,
                startedAt: Date.now(),
                logs: [
                  `[${new Date().toLocaleTimeString()}] ${e(
                    "specHub.autoCombo.logDispatch"
                  )}`,
                ],
              });
            const ce = (A) => {
                fe((L) => ({
                  ...L,
                  logs: [
                    ...L.logs,
                    `[${new Date().toLocaleTimeString()}] ${A}`,
                  ],
                }));
              },
              B = (A) => {
                fe((L) => ({
                  ...L,
                  streamOutput: L.streamOutput
                    ? `${L.streamOutput}
${A}`
                    : A,
                }));
              };
            try {
              const A = await Li({
                workspaceId: r,
                changeId: l.id,
                customSpecRoot: X,
              });
              if (A.specsExists)
                ce(e("specHub.autoCombo.logAuditPassed")),
                  B(e("specHub.autoCombo.logAuditPassed")),
                  fe((L) => ({
                    ...L,
                    status: "success",
                    phase: "audit",
                    finishedAt: Date.now(),
                    summary: e("specHub.autoCombo.summaryReady"),
                    changedFiles: A.specPaths,
                    error: null,
                  }));
              else {
                ce(e("specHub.autoCombo.logAuditMissingSpecs")),
                  B(e("specHub.autoCombo.logAuditMissingSpecs")),
                  fe((Y) => ({
                    ...Y,
                    phase: "remediate",
                    logs: [
                      ...Y.logs,
                      `[${new Date().toLocaleTimeString()}] ${e(
                        "specHub.autoCombo.logRemediateDispatch",
                        { engine: q(S) }
                      )}`,
                    ],
                  }));
                const L = {
                    ...R,
                    summary: `${R.summary} ${e(
                      "specHub.autoCombo.remediateHint"
                    )}`.trim(),
                    risks: [
                      ...R.risks,
                      e("specHub.autoCombo.riskMissingSpecs"),
                    ],
                    verificationPlan: [
                      ...R.verificationPlan,
                      e("specHub.autoCombo.verifyPlanEnsureSpecs"),
                    ],
                    executionSequence: [
                      ...R.executionSequence,
                      e("specHub.autoCombo.sequenceFixSpecsFirst"),
                    ],
                  },
                  se = await Fs({
                    continueBriefOverride: L,
                    forceUseContinueBrief: !0,
                    ignoreAvailability: !0,
                    positionOverride: d ?? null,
                    skipPositionReset: !0,
                  });
                se?.output?.trim() && B(se.output.trim()),
                  ce(
                    se?.success
                      ? e("specHub.autoCombo.logRemediateFinished")
                      : e("specHub.autoCombo.logRemediateFailed")
                  ),
                  fe((Y) => ({ ...Y, phase: "verify" }));
                const _ = await Li({
                    workspaceId: r,
                    changeId: l.id,
                    customSpecRoot: X,
                  }),
                  x = _.specsExists,
                  nt = [
                    ..._.specPaths,
                    ...(_.tasksExists ? [_.tasksPath] : []),
                  ].filter((Y, T, F) => F.indexOf(Y) === T);
                fe((Y) => ({
                  ...Y,
                  status: x ? "success" : "failed",
                  phase: "verify",
                  finishedAt: Date.now(),
                  summary: e(
                    x
                      ? "specHub.autoCombo.summaryRecovered"
                      : "specHub.autoCombo.summaryStillMissing"
                  ),
                  changedFiles: nt,
                  error: x ? null : e("specHub.autoCombo.errorStillMissing"),
                }));
              }
            } catch (A) {
              const L = A instanceof Error ? A.message : String(A);
              fe((se) => ({
                ...se,
                status: "failed",
                phase: se.phase === "idle" ? "audit" : se.phase,
                finishedAt: Date.now(),
                summary: e("specHub.autoCombo.summaryFailed"),
                error: e("specHub.autoCombo.errorWithReason", { reason: L }),
              }));
            }
            re((A) => ({
              ...A,
              status: K ? "success" : "failed",
              phase: "apply-finalize",
              finishedAt: Date.now(),
              error: K
                ? null
                : e("specHub.continueAiEnhancement.autoApplyFailed"),
              logs: [
                ...A.logs,
                `[${new Date().toLocaleTimeString()}] ${e(
                  K
                    ? "specHub.continueAiEnhancement.logAutoApplyFinished"
                    : "specHub.continueAiEnhancement.logAutoApplySkipped"
                )}`,
              ],
            }));
          } catch (m) {
            const f = m instanceof Error ? m.message : String(m),
              R = e("specHub.continueAiEnhancement.failed", { reason: f });
            re((U) => ({
              ...U,
              status: "failed",
              finishedAt: Date.now(),
              summary: U.summary,
              error: R,
              logs: [...U.logs, `[${new Date().toLocaleTimeString()}] ${R}`],
            }));
          } finally {
            on(!1);
          }
          return o;
        }
        if (s === "apply") return ds(!1), Fs();
        if (s === "verify") {
          It(null);
          const o = !!z.verification.exists;
          if (!rs || o || !$) return Xe(s);
          const r = Date.now();
          Aa(!1),
            Ha(!1),
            st(),
            De({
              ...Si,
              status: "running",
              phase: "completion-dispatch",
              executor: S,
              startedAt: r,
              logs: [
                `[${new Date().toLocaleTimeString()}] [completion-dispatch] ${e(
                  "specHub.verifyAutoComplete.logDispatch",
                  { engine: q(S) }
                )}`,
              ],
            }),
            ls(!0);
          try {
            De((d) => ({
              ...d,
              phase: "completion-execution",
              logs: [
                ...d.logs,
                `[${new Date().toLocaleTimeString()}] [completion-execution] ${e(
                  "specHub.verifyAutoComplete.logCompletionStarted"
                )}`,
              ],
            }));
            const l = Ar({ workspaceName: i, changeId: $.id, specRoot: ze }),
              b = await Rs({
                prompt: l,
                engine: S,
                onDelta: (d) => {
                  De((h) => ({ ...h, streamOutput: `${h.streamOutput}${d}` }));
                },
                onLog: (d) => {
                  De((h) => ({
                    ...h,
                    logs: [
                      ...h.logs,
                      `[${new Date().toLocaleTimeString()}] [completion-execution] ${d}`,
                    ],
                  }));
                },
              });
            De((d) => ({
              ...d,
              phase: "completion-finalize",
              finalOutput: b,
              summary: e(
                "specHub.verifyAutoComplete.summaryCompletionFinished"
              ),
              logs: [
                ...d.logs,
                `[${new Date().toLocaleTimeString()}] [completion-finalize] ${e(
                  "specHub.verifyAutoComplete.logRefreshStarted"
                )}`,
              ],
            })),
              await yt({ force: !0, rescanWorkspaceFiles: !0 }),
              De((d) => ({
                ...d,
                phase: "verify-dispatch",
                logs: [
                  ...d.logs,
                  `[${new Date().toLocaleTimeString()}] [verify-dispatch] ${e(
                    "specHub.verifyAutoComplete.logVerifyDispatch"
                  )}`,
                ],
              })),
              await Xe(s),
              De((d) => ({
                ...d,
                status: "success",
                phase: "verify-finalize",
                finishedAt: Date.now(),
                summary:
                  d.summary || e("specHub.verifyAutoComplete.summarySuccess"),
                error: null,
                validateSkipped: !1,
                logs: [
                  ...d.logs,
                  `[${new Date().toLocaleTimeString()}] [verify-finalize] ${e(
                    "specHub.verifyAutoComplete.logVerifyFinished"
                  )}`,
                ],
              }));
            return;
          } catch (l) {
            const b = l instanceof Error ? l.message : String(l),
              d = e("specHub.verifyAutoComplete.failed", { reason: b });
            It(d),
              De((h) => ({
                ...h,
                status: "failed",
                phase: h.phase === "idle" ? "completion-finalize" : h.phase,
                finishedAt: Date.now(),
                summary: e("specHub.verifyAutoComplete.validateSkipped"),
                error: d,
                validateSkipped: !0,
                logs: [
                  ...h.logs,
                  `[${new Date().toLocaleTimeString()}] [completion-finalize] ${d}`,
                ],
              }));
            return;
          } finally {
            ls(!1);
          }
        }
        return Xe(s);
      },
      [
        ze,
        S,
        ps,
        ri,
        z.verification.exists,
        X,
        us,
        Be,
        Ct,
        Xe,
        yt,
        st,
        Rs,
        $,
        e,
        Fs,
        rs,
        a,
        i,
      ]
    ),
    lc = async () => {
      if (!a || !be) return;
      const s = ha.trim();
      if (!s && vt.length === 0) {
        ge(e("specHub.proposal.emptyInputError"));
        return;
      }
      if (be === "append" && !an) {
        ge(e("specHub.proposal.targetRequired"));
        return;
      }
      for (const d of vt) {
        const h = wn(d);
        if (!h.ok) {
          ge($s(h.reason, h.value));
          return;
        }
      }
      const o = be,
        r = an,
        l = [...vt],
        b = Date.now();
      Lt(null),
        ge(null),
        Ue([]),
        mn(!1),
        hn(!1),
        st(),
        Me({
          ...Bn,
          status: "running",
          phase: "dispatch",
          mode: o,
          targetChangeId: r,
          executor: S,
          startedAt: b,
          logs: [
            `[${new Date().toLocaleTimeString()}] [dispatch] ${e(
              "specHub.proposal.logDispatch",
              { engine: q(S) }
            )}`,
          ],
        });
      try {
        const d = yr({
          mode: o,
          content: s,
          attachments: l,
          targetChangeId: r,
          specRoot: ze,
          workspaceName: i,
        });
        Me((B) => ({ ...B, phase: "execution" })),
          Ps("execution", e("specHub.proposal.logExecutionStarted"));
        const h = await Rs({
            prompt: d,
            engine: S,
            images: l,
            onDelta: (B) => {
              Me((A) => ({ ...A, streamOutput: `${A.streamOutput}${B}` }));
            },
            onLog: (B) => Ps("execution", B),
          }),
          m = Un(h),
          f =
            typeof m?.summary == "string" && m.summary.trim()
              ? m.summary.trim()
              : "",
          R =
            typeof m?.change_id == "string" && m.change_id.trim()
              ? m.change_id.trim()
              : r;
        Me((B) => ({
          ...B,
          phase: "finalize",
          targetChangeId: R ?? B.targetChangeId,
          finalOutput: h,
          summary: f || e("specHub.proposal.summaryFallback"),
        })),
          Ps("finalize", e("specHub.proposal.logRefreshStarted")),
          await yt({ force: !0, rescanWorkspaceFiles: !0 });
        const U = R ?? r;
        U && (await bn(U), Le(U));
        const K = await Dn(a),
          ce =
            U && K.files.length > 0
              ? await Bc({
                  workspaceId: a,
                  changeId: U,
                  files: K.files,
                  customSpecRoot: X,
                })
              : { blockers: [], hints: [], affectedSpecs: [] };
        Ps(
          "finalize",
          `stage=proposal_post change=${U ?? "unknown"} blocker_count=${
            ce.blockers.length
          }`
        ),
          Me((B) => ({
            ...B,
            status: "success",
            phase: "finalize",
            finishedAt: Date.now(),
            finalOutput: h,
            summary:
              ce.blockers.length > 0
                ? `${B.summary || e("specHub.proposal.runSuccess")} \xB7 ${e(
                    "specHub.runtime.validationFixHint"
                  )}`
                : B.summary || e("specHub.proposal.runSuccess"),
            error: null,
            preflightBlockers: ce.blockers,
            preflightHints: ce.hints,
          }));
      } catch (d) {
        const h = d instanceof Error ? d.message : String(d);
        Me((m) => ({
          ...m,
          status: "failed",
          phase: m.phase === "idle" ? "dispatch" : m.phase,
          finishedAt: Date.now(),
          error: h,
          logs: [
            ...m.logs,
            `[${new Date().toLocaleTimeString()}] [${m.phase}] ${h}`,
          ],
        }));
      }
    },
    uc = async () => {
      if (!a || !$ || He) return;
      const s = Date.now();
      let o = "kickoff",
        r = 0;
      ts(null),
        Fe(null),
        js(null),
        Vs(""),
        me("running"),
        ns("kickoff"),
        as("idle"),
        qs([]),
        oa(s),
        Xs(null),
        Ks(0),
        Js(!1),
        Zs(!1),
        j("kickoff", "info", e("specHub.aiTakeover.logKickoffStarted")),
        sa(!0);
      try {
        const l = kr({
            workspaceName: i,
            changeId: $.id,
            specRoot: ze,
            blockers: Ka,
            latestArchiveOutput: ys,
          }),
          b = (h) =>
            new Promise((m, f) => {
              const R = new Set([h]);
              let U = "",
                K = !1;
              const ce = window.setTimeout(() => {
                  K ||
                    ((K = !0),
                    A(),
                    f(new Error(e("specHub.aiTakeover.turnTimeout"))));
                }, 900 * 1e3),
                B = (L) => {
                  K || ((K = !0), window.clearTimeout(ce), A(), L());
                },
                A = ki((L) => {
                  if (L.workspace_id !== a) return;
                  const se = L.message,
                    _ = String(se.method ?? ""),
                    x = se.params ?? {},
                    nt = x.turn,
                    Y = String(
                      x.threadId ??
                        x.thread_id ??
                        nt?.threadId ??
                        nt?.thread_id ??
                        ""
                    );
                  if (_ === "thread/started" && Y && R.has(Y)) {
                    const T = String(x.sessionId ?? x.session_id ?? ""),
                      F = String(x.engine ?? "").toLowerCase();
                    if (
                      T &&
                      T !== "pending" &&
                      (F === "claude" || F === "opencode")
                    ) {
                      const at = `${F}:${T}`;
                      R.has(at) ||
                        (R.add(at),
                        j(
                          "agent",
                          "info",
                          e("specHub.aiTakeover.logThreadBound", {
                            threadId: at,
                          })
                        ));
                    }
                    return;
                  }
                  if (!(!Y || !R.has(Y))) {
                    if (_ === "item/agentMessage/delta") {
                      const T = String(x.delta ?? "");
                      T && ((U += T), Vs((F) => F + T));
                      return;
                    }
                    if (_ === "item/started") {
                      const T = x.item ?? {},
                        F = String(T.tool ?? T.id ?? "").trim();
                      F &&
                        j(
                          "agent",
                          "info",
                          e("specHub.aiTakeover.logToolStarted", { tool: F })
                        );
                      return;
                    }
                    if (_ === "item/completed") {
                      const T = x.item ?? {},
                        F = String(T.tool ?? T.id ?? "").trim();
                      F &&
                        j(
                          "agent",
                          "success",
                          e("specHub.aiTakeover.logToolCompleted", { tool: F })
                        );
                      return;
                    }
                    if (_ === "processing/heartbeat") {
                      (r += 1),
                        (r === 1 || r % 6 === 0) &&
                          j(
                            "agent",
                            "info",
                            e("specHub.aiTakeover.logHeartbeat", { seconds: r })
                          );
                      return;
                    }
                    if (_ === "turn/error" || _ === "error") {
                      const F =
                        (x.error && typeof x.error == "object"
                          ? String(x.error.message ?? "")
                          : String(x.error ?? "")
                        ).trim() || e("specHub.aiTakeover.turnErrorFallback");
                      B(() => f(new Error(F)));
                      return;
                    }
                    if (_ === "turn/completed") {
                      const T = Mi(x),
                        F = U.trim() || T.trim();
                      B(() => m(F));
                    }
                  }
                });
            });
        j(
          "agent",
          "info",
          e("specHub.aiTakeover.logAgentStarted", { engine: q(S) })
        ),
          (o = "agent"),
          ns("agent");
        let d = "";
        if (S === "codex") {
          const h = await Hi(a),
            m = Ds(h);
          if (!m) throw new Error(e("specHub.aiTakeover.missingThreadId"));
          j(
            "agent",
            "info",
            e("specHub.aiTakeover.logThreadBound", { threadId: m })
          );
          const f = b(m);
          await Ai(a, m, l, { accessMode: "full-access", customSpecRoot: X }),
            (d = await f);
        } else {
          const h = await yi(a, {
              text: l,
              engine: S,
              accessMode: "full-access",
              continueSession: !1,
              customSpecRoot: X,
            }),
            m = Ds(h);
          m
            ? (j(
                "agent",
                "info",
                e("specHub.aiTakeover.logThreadBound", { threadId: m })
              ),
              (d = await b(m)))
            : (d = (
                await In(a, {
                  text: l,
                  engine: S,
                  accessMode: "full-access",
                  continueSession: !1,
                  customSpecRoot: X,
                })
              ).text);
        }
        js(d),
          j("agent", "success", e("specHub.aiTakeover.logAgentFinished")),
          j("refresh", "info", e("specHub.aiTakeover.logRefreshStarted")),
          (o = "refresh"),
          ns("refresh");
        try {
          await yt({ force: !0, rescanWorkspaceFiles: !0 }),
            as("refreshed"),
            j("refresh", "success", e("specHub.aiTakeover.logRefreshFinished"));
          const h = await li($.id);
          if (h.ready)
            if (
              (ts(e("specHub.aiTakeover.success", { engine: q(S) })),
              j("refresh", "success", e("specHub.aiTakeover.logArchiveReady")),
              na)
            ) {
              j("refresh", "info", e("specHub.aiTakeover.logArchiveStarted")),
                Ws(!0);
              try {
                const m = await Gc({
                  workspaceId: a,
                  changeId: $.id,
                  action: "archive",
                  provider: E.provider,
                  customSpecRoot: X,
                });
                if (!m.success) {
                  const R =
                    m.output.trim() ||
                    e("specHub.aiTakeover.archiveUnknownFailure");
                  j(
                    "refresh",
                    "error",
                    e("specHub.aiTakeover.logArchiveFailed", { reason: R })
                  ),
                    Fe(e("specHub.aiTakeover.archiveFailed", { reason: R })),
                    me("failed");
                  return;
                }
                await yt({ force: !0, rescanWorkspaceFiles: !0 });
                const f = await li($.id);
                if (f.archived)
                  j(
                    "refresh",
                    "success",
                    e("specHub.aiTakeover.logArchiveFinished")
                  ),
                    ts(e("specHub.aiTakeover.successArchived")),
                    me("success");
                else {
                  const R = V(
                    f.blockers[0] ??
                      e("specHub.aiTakeover.archiveUnknownFailure"),
                    e
                  );
                  j(
                    "refresh",
                    "error",
                    e("specHub.aiTakeover.logArchiveFailed", { reason: R })
                  ),
                    Fe(e("specHub.aiTakeover.archiveFailed", { reason: R })),
                    me("failed");
                }
              } catch (m) {
                const f = m instanceof Error ? m.message : String(m);
                j(
                  "refresh",
                  "error",
                  e("specHub.aiTakeover.logArchiveFailed", { reason: f })
                ),
                  Fe(e("specHub.aiTakeover.archiveFailed", { reason: f })),
                  me("failed");
              } finally {
                Ws(!1);
              }
            } else me("success");
          else {
            const m =
                h.blockers[0] ?? e("specHub.runtime.requiredTasksIncomplete"),
              f = V(m, e);
            me("failed"),
              Fe(e("specHub.aiTakeover.stillBlocked", { reason: f })),
              j(
                "refresh",
                "error",
                e("specHub.aiTakeover.logStillBlocked", { reason: f })
              );
          }
        } catch (h) {
          const m = h instanceof Error ? h.message : String(h);
          as("refresh-failed"),
            me("failed"),
            Fe(e("specHub.aiTakeover.refreshFailed", { reason: m })),
            j(
              "refresh",
              "error",
              e("specHub.aiTakeover.logRefreshFailed", { reason: m })
            );
        }
      } catch (l) {
        const b = l instanceof Error ? l.message : String(l);
        me("failed"),
          Fe(b),
          j(o, "error", e("specHub.aiTakeover.logRunFailed", { reason: b }));
      } finally {
        Xs(Date.now()), sa(!1);
      }
    },
    pc = async () => {
      const s = Ci(ta);
      if (!s) {
        await gn(null), Re(e("specHub.bootstrap.specRootSavedDefault"));
        return;
      }
      if (!vr(s)) {
        bt(e("specHub.bootstrap.specRootMustBeAbsolute"));
        return;
      }
      bt(null),
        Re(null),
        await gn(s),
        Re(e("specHub.bootstrap.specRootSavedCustom", { path: s }));
    },
    dc = async () => {
      bt(null),
        Re(null),
        zs(""),
        await gn(null),
        Re(e("specHub.bootstrap.specRootSavedDefault"));
    },
    mc = (s) => {
      if (s) {
        if (s.includes("tasks")) {
          N("tasks");
          return;
        }
        if (s.includes("design")) {
          N("design");
          return;
        }
        if (s.includes("proposal")) {
          N("proposal");
          return;
        }
        if (s.includes("spec")) {
          N("specs");
          return;
        }
        s.includes("verification") && N("verification");
      }
    },
    pi = e(
      ye ? "specHub.expandControlCenter" : "specHub.collapseControlCenter"
    ),
    emptyStateTitle = e(
      y === "backlog" ? "specHub.noBacklogChanges" : "specHub.noChanges"
    ),
    emptyStateHint = e(
      y === "backlog" ? "specHub.noBacklogChangesHint" : "specHub.noChangesHint"
    ),
    renderChangeItem = (change) => {
      const statusMeta = Ei[change.status],
        StatusIcon = statusMeta.icon,
        isSelected = $?.id === change.id,
        isBacklogMember = changeBacklogIdSet.has(change.id),
        contextLabel = e(
          isBacklogMember
            ? "specHub.changeAction.removeFromBacklog"
            : "specHub.changeAction.moveToBacklog"
        );
      return n(
        "button",
        {
          type: "button",
          className: `spec-hub-change-item ${isSelected ? "is-active" : ""}${
            isBacklogMember ? " is-backlog" : ""
          } border rounded-lg bg-[color:var(--surface-item)] flex items-center gap-2 w-full p-2 text-left${isSelected ? " border-[color:var(--border-strong)] bg-[color:var(--surface-active)]" : " border-[color:var(--border-muted)]"}${isBacklogMember && !isSelected ? " border-dashed" : ""}`,
          onClick: () => {
            bn(change.id), setChangeContextMenu(null);
          },
          onContextMenu: (event) => {
            event.preventDefault(),
              openChangeContextMenu(change, {
                x: event.clientX,
                y: event.clientY,
              });
          },
          onKeyDown: (event) => {
            if (
              event.key !== "ContextMenu" &&
              !(event.shiftKey && event.key === "F10")
            )
              return;
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            openChangeContextMenu(change, {
              x: rect.right - 12,
              y: rect.top + 28,
            });
          },
          title: isBacklogMember ? e("specHub.changeBacklogHint") : void 0,
          "aria-label": isBacklogMember
            ? e("specHub.changeRowAriaLabelBacklog", {
                id: change.id,
                status: e(`specHub.status.${change.status}`),
                action: contextLabel,
              })
            : void 0,
          children: [
            t(StatusIcon, {
              "aria-hidden": !0,
              size: 16,
              className: `spec-hub-status-icon ${statusMeta.className} w-4 h-4 flex-[0_0_16px] [stroke-width:2.1]`,
            }),
            n("div", {
              className: "spec-hub-change-meta flex flex-col min-w-0",
              children: [
                t("span", {
                  className: "spec-hub-change-id text-[12px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis",
                  children: change.id,
                }),
                n("span", {
                  className: "spec-hub-change-status text-[11px] text-[color:var(--text-muted)] inline-flex items-center flex-wrap gap-1",
                  children: [
                    t(StatusIcon, {
                      "aria-hidden": !0,
                      size: 12,
                      className: `spec-hub-change-status-accent ${statusMeta.className} w-3 h-3 flex-[0_0_12px] [stroke-width:2.15] opacity-90`,
                    }),
                    e(`specHub.status.${change.status}`),
                    isBacklogMember
                      ? t("span", {
                          className:
                            "spec-hub-change-chip spec-hub-change-chip-backlog inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-bold leading-[1.4] bg-[color-mix(in_srgb,var(--info,#2563eb)_16%,transparent)] text-[color-mix(in_srgb,var(--info,#2563eb)_82%,var(--text-primary)_18%)]",
                          children: e("specHub.changeBacklogBadge"),
                        })
                      : null,
                  ],
                }),
              ],
            }),
          ],
        },
        change.id
      );
    };
  return n("section", {
    className: `spec-hub ${ke ? "is-artifact-maximized" : ""}`,
    children: [
      n("header", {
        className: "spec-hub-header",
        children: [
          n("div", {
            className: "spec-hub-title-wrap",
            children: [
              t("h2", { children: e("specHub.title") }),
              t("p", {
                children: i
                  ? e("specHub.subtitleWithWorkspace", { workspace: i })
                  : e("specHub.subtitle"),
              }),
            ],
          }),
          n("div", {
            className: "spec-hub-header-side",
            children: [
              n("div", {
                className: "spec-hub-header-badges",
                children: [
                  n(_e, {
                    variant: "outline",
                    className: `spec-hub-badge ${mo}`,
                    children: [
                      t("span", {
                        className: "spec-hub-badge-dot",
                        "aria-hidden": !0,
                      }),
                      oo,
                    ],
                  }),
                  t(_e, {
                    variant:
                      E.supportLevel === "full" ? "secondary" : "outline",
                    className: `spec-hub-badge ${ho}`,
                    children:
                      E.supportLevel === "full"
                        ? e("specHub.supportFull")
                        : E.supportLevel === "minimal"
                        ? e("specHub.supportMinimal")
                        : e("specHub.supportNone"),
                  }),
                  n(_e, {
                    variant: uo,
                    className: `spec-hub-badge spec-hub-badge-gate is-${Ye.status}`,
                    title: e(`specHub.gateMeaning.${Ye.status}`),
                    children: [
                      t(po, { size: 12, "aria-hidden": !0 }),
                      e(`specHub.gateHeader.${Ye.status}`),
                    ],
                  }),
                ],
              }),
              n("div", {
                className: "spec-hub-header-ops inline-flex items-center gap-0.5 p-0",
                children: [
                  t("button", {
                    type: "button",
                    className: "spec-hub-header-icon-action is-control w-6 h-6 min-h-6 inline-flex items-center justify-center border-none bg-transparent rounded-[6px] p-0 leading-none transition-transform transition-colors duration-[120ms] ease text-[#334155] hover:not-disabled:-translate-y-px hover:not-disabled:scale-[1.03] hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover)_55%,transparent)] active:not-disabled:translate-y-0 disabled:opacity-[0.62]",
                    onClick: () => {
                      es((s) => !s);
                    },
                    title: pi,
                    "aria-label": pi,
                    children: ye
                      ? t(Sc, { size: 15, "aria-hidden": !0 })
                      : t(xc, { size: 15, "aria-hidden": !0 }),
                  }),
                  t("button", {
                    type: "button",
                    className: "spec-hub-header-icon-action is-refresh w-6 h-6 min-h-6 inline-flex items-center justify-center border-none bg-transparent rounded-[6px] p-0 leading-none transition-transform transition-colors duration-[120ms] ease text-[#1d4ed8] hover:not-disabled:-translate-y-px hover:not-disabled:scale-[1.03] hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover)_55%,transparent)] active:not-disabled:translate-y-0 disabled:opacity-[0.62]",
                    onClick: () => {
                      yt();
                    },
                    disabled: Oa,
                    title: e("specHub.refresh"),
                    "aria-label": e("specHub.refresh"),
                    children: t(bi, {
                      size: 15,
                      "aria-hidden": !0,
                      className: Oa ? "spin" : void 0,
                    }),
                  }),
                  t("button", {
                    type: "button",
                    className: "spec-hub-header-icon-action is-chat w-6 h-6 min-h-6 inline-flex items-center justify-center border-none bg-transparent rounded-[6px] p-0 leading-none transition-transform transition-colors duration-[120ms] ease text-[#047857] hover:not-disabled:-translate-y-px hover:not-disabled:scale-[1.03] hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover)_55%,transparent)] active:not-disabled:translate-y-0 disabled:opacity-[0.62]",
                    onClick: k,
                    title: e("specHub.backToChat"),
                    "aria-label": e("specHub.backToChat"),
                    children: t(Nc, { size: 15, "aria-hidden": !0 }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      n("div", {
        className: `spec-hub-grid${ke ? " is-artifact-maximized" : ""}${
          ye ? " is-control-collapsed" : ""
        } min-h-0 flex-1 grid overflow-hidden gap-3${ke ? " [grid-template-columns:minmax(0,1fr)]" : ye ? " [grid-template-columns:clamp(210px,17vw,260px)_minmax(0,1fr)]" : " [grid-template-columns:clamp(210px,17vw,260px)_minmax(0,1fr)_clamp(300px,24vw,360px)]"}`,
        children: [
          n("aside", {
            className: "spec-hub-changes border border-[color:var(--border-muted)] bg-card rounded-[10px] min-h-0 overflow-hidden flex flex-col",
            children: [
              t("div", {
                className: "spec-hub-panel-header px-2.5 py-2 border-b border-[color:var(--border-subtle)] flex items-center justify-between gap-2",
                children: n("div", {
                  className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                  children: [
                    t(Tc, { size: 14, "aria-hidden": !0 }),
                    t("span", { children: e("specHub.changes") }),
                  ],
                }),
              }),
              n("div", {
                className: "spec-hub-change-filters px-2.5 py-2 border-b border-[color:var(--border-subtle)] flex items-center gap-2 text-[color:var(--text-muted)]",
                children: [
                  t("button", {
                    type: "button",
                    className: "spec-hub-group-toggle-all flex-[0_0_auto] inline-flex items-center justify-center rounded-full border border-[color:var(--border-muted)] bg-[color:var(--surface-subtle)] text-[color:var(--text-secondary)] w-6 h-6 p-0 disabled:opacity-[0.55] disabled:cursor-not-allowed hover:not-disabled:text-[color:var(--text-primary)] hover:not-disabled:border-[color:var(--border-strong)]",
                    onClick: lo,
                    disabled: co,
                    "aria-label": e(
                      yn
                        ? "specHub.groupControls.collapseAll"
                        : "specHub.groupControls.expandAll"
                    ),
                    children: t($n, { size: 13, "aria-hidden": !0 }),
                  }),
                  t("div", {
                    className: "spec-hub-filter-group flex-1 min-w-0 grid [grid-template-columns:repeat(5,minmax(0,1fr))] gap-0.5 p-0.5 rounded-full border border-[color:var(--border-muted)] bg-[color:var(--surface-subtle)]",
                    role: "group",
                    "aria-label": e("specHub.filterTitle"),
                    children: [
                      "all",
                      "active",
                      "backlog",
                      "blocked",
                      "archived",
                    ].map((s) =>
                      t(
                        "button",
                        {
                          type: "button",
                          className: `spec-hub-filter-chip ${
                            y === s ? "is-active" : ""
                          } py-1 px-2 border-0 rounded-full text-[12px] font-semibold min-w-0 whitespace-nowrap overflow-hidden text-ellipsis transition-colors duration-[140ms] ease${y === s ? " bg-[color:var(--surface-control-hover)] text-[color:var(--text-primary)]" : " text-[color:var(--text-muted)]"}`,
                          "aria-pressed": y === s,
                          onClick: () => ae(s),
                          children: e(`specHub.filter.${s}`),
                        },
                        s
                      )
                    ),
                  }),
                ],
              }),
              n("div", {
                className: "spec-hub-change-list flex-1 min-h-0 p-2.5 flex flex-col gap-2 overflow-auto",
                children: [
                  At.length === 0 &&
                    n("div", {
                      className: "spec-hub-empty-state",
                      children: [
                        t(qt, { size: 18, "aria-hidden": !0 }),
                        t("p", {
                          className: "spec-hub-empty-state-title",
                          children: emptyStateTitle,
                        }),
                        t("p", {
                          className: "spec-hub-empty-state-desc",
                          children: emptyStateHint,
                        }),
                      ],
                    }),
                  kn
                    ? Ke.map((s) => {
                        const o = ja.has(s.key),
                          r = s.kind === "date" ? gc : Ac;
                        return n(
                          "section",
                          {
                            className: "spec-hub-change-group flex flex-col gap-1.5",
                            "aria-label": s.label,
                            children: [
                              n("button", {
                                type: "button",
                                className: "spec-hub-change-group-toggle border border-[color:var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-item)_86%,transparent)] rounded-lg text-[color:var(--text-secondary)] flex items-center gap-1.5 w-full px-2 py-1.5 text-[12px] font-semibold text-left hover:text-[color:var(--text-primary)] hover:border-[color:var(--border-muted)]",
                                "aria-expanded": o,
                                onClick: () => ro(s.key),
                                children: [
                                  t(r, {
                                    size: 13,
                                    "aria-hidden": !0,
                                    className: "spec-hub-change-group-icon flex-[0_0_13px] text-[color:var(--text-muted)]",
                                  }),
                                  t(fc, {
                                    size: 14,
                                    "aria-hidden": !0,
                                    className: `spec-hub-change-group-chevron ${
                                      o ? "is-expanded" : ""
                                    } flex-[0_0_14px] transition-transform duration-[160ms] ease${o ? " rotate-90" : ""}`,
                                  }),
                                  t("span", {
                                    className: "spec-hub-change-group-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
                                    children: s.label,
                                  }),
                                  t("span", {
                                    className: "spec-hub-change-group-count ml-auto text-[color:var(--text-muted)] text-[11px]",
                                    children: s.changes.length,
                                  }),
                                ],
                              }),
                              o
                                ? t("div", {
                                    className: "spec-hub-change-group-items flex flex-col gap-1.5 pl-3.5",
                                    children: s.changes.map((l) =>
                                      renderChangeItem(l)
                                    ),
                                  })
                                : null,
                            ],
                          },
                          s.key
                        );
                      })
                    : At.map((s) => renderChangeItem(s)),
                ],
              }),
            ],
          }),
          n("section", {
            className: "spec-hub-artifacts border border-[color:var(--border-muted)] bg-card rounded-[10px] min-h-0 overflow-hidden flex flex-col",
            children: [
              n("div", {
                className: "spec-hub-panel-header px-2.5 py-2 border-b border-[color:var(--border-subtle)] flex items-center justify-between gap-2",
                children: [
                  n("div", {
                    className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                    children: [
                      t(yc, { size: 14, "aria-hidden": !0 }),
                      t("span", { children: e("specHub.artifacts") }),
                    ],
                  }),
                  n("button", {
                    type: "button",
                    className: "ghost spec-hub-panel-compact-action",
                    onClick: () => {
                      Qt((s) => !s);
                    },
                    title: e(
                      ke
                        ? "specHub.restoreArtifacts"
                        : "specHub.maximizeArtifacts"
                    ),
                    children: [
                      ke
                        ? t(ot, { size: 14, "aria-hidden": !0 })
                        : t(it, { size: 14, "aria-hidden": !0 }),
                      t("span", {
                        children: e(
                          ke
                            ? "specHub.restoreArtifacts"
                            : "specHub.maximizeArtifacts"
                        ),
                      }),
                    ],
                  }),
                ],
              }),
              $
                ? n(fi, {
                    value: g,
                    onValueChange: N,
                    className: "spec-hub-tabs min-h-0 flex flex-col flex-1 [&_[role='tablist']]:mx-2.5 [&_[role='tablist']]:mt-2.5 [&_[role='tablist']]:mb-0 [&_[role='tablist']]:flex [&_[role='tablist']]:flex-nowrap [&_[role='tablist']]:items-center [&_[role='tablist']]:gap-1.5 [&_[role='tablist']]:overflow-x-auto [&_[role='tablist']]:p-0.5 [&_[role='tablist']]:bg-[color:var(--surface-item)] [&_[role='tablist']]:border [&_[role='tablist']]:border-[color:var(--border-subtle)] [&_[role='tablist']]:rounded-[10px] [&_[data-slot='tab-indicator']]:bg-[color:var(--surface-card)] [&_[data-slot='tab-indicator']]:[box-shadow:inset_0_0_0_1px_var(--border-subtle),0_1px_2px_color-mix(in_srgb,var(--text-primary)_10%,transparent)] [&_[role='tab']]:flex-[0_0_auto] [&_[role='tab']]:inline-flex [&_[role='tab']]:items-center [&_[role='tab']]:justify-center [&_[role='tab']]:gap-1.5 [&_[role='tab']]:px-2.5 [&_[role='tab']]:py-1.5 [&_[role='tab']]:rounded-lg [&_[role='tab']]:text-[12px] [&_[role='tab']]:font-semibold [&_[role='tab']]:text-[color:var(--text-secondary)] [&_[role='tab']:hover]:text-[color:var(--text-primary)] [&_[role='tab'][aria-selected='true']]:text-[color:var(--text-stronger)] [&_[role='tab'][data-selected]]:text-[color:var(--text-stronger)] [&_[role='tab'][data-state='active']]:text-[color:var(--text-stronger)]",
                    children: [
                      n(vi, {
                        children: [
                          t(we, {
                            value: "proposal",
                            children: e("specHub.tab.proposal"),
                          }),
                          t(we, {
                            value: "design",
                            children: e("specHub.tab.design"),
                          }),
                          t(we, {
                            value: "specs",
                            children: e("specHub.tab.specs"),
                          }),
                          t(we, {
                            value: "tasks",
                            children: e("specHub.tab.tasks"),
                          }),
                          t(we, {
                            value: "verification",
                            children: e("specHub.tab.verification"),
                          }),
                        ],
                      }),
                      [
                        "proposal",
                        "design",
                        "specs",
                        "tasks",
                        "verification",
                      ].map((s) =>
                        n(
                          Xt,
                          {
                            value: s,
                            className: "spec-hub-artifact-content min-h-0 flex-1 flex flex-col p-2.5 gap-2",
                            children: [
                              s === "specs" && ue.length > 1
                                ? n("div", {
                                    className: "spec-hub-spec-file-switcher flex items-center gap-2 min-h-[30px]",
                                    children: [
                                      t("span", {
                                        className: "spec-hub-spec-file-count flex-shrink-0 text-[11px] text-[color:var(--text-muted)]",
                                        children: e("specHub.specFileCount", {
                                          count: ue.length,
                                        }),
                                      }),
                                      t("div", {
                                        className: "spec-hub-spec-file-list min-w-0 flex items-center gap-1.5 overflow-x-auto pb-0.5",
                                        children: ue.map((o, r) =>
                                          t(
                                            "button",
                                            {
                                              type: "button",
                                              className: `spec-hub-spec-file-chip ${
                                                Ht?.path === o.path
                                                  ? "is-active"
                                                  : ""
                                              } inline-flex items-center border rounded-full bg-[color:var(--surface-item)] text-[color:var(--text-secondary)] px-2.5 py-[3px] text-[11px] whitespace-nowrap${Ht?.path === o.path ? " border-[color:var(--border-strong)] bg-[color:var(--surface-active)] text-[color:var(--text-stronger)]" : " border-[color:var(--border-muted)]"}`,
                                              onClick: () => {
                                                mt(o.path);
                                              },
                                              title: o.path,
                                              children: t("span", {
                                                children: rr(o.path, r, e),
                                              }),
                                            },
                                            o.path
                                          )
                                        ),
                                      }),
                                    ],
                                  })
                                : null,
                              n("div", {
                                className: "spec-hub-artifact-meta min-h-6 flex items-center justify-between gap-2 text-[color:var(--text-muted)] text-[11px]",
                                children: [
                                  t("span", {
                                    className: "spec-hub-artifact-path flex-1 min-w-0 whitespace-nowrap overflow-hidden text-ellipsis",
                                    title:
                                      s === "specs"
                                        ? Ht?.path ?? z[s].path ?? void 0
                                        : z[s].path ?? void 0,
                                    children:
                                      s === "specs"
                                        ? Ht?.path ??
                                          z[s].path ??
                                          e("specHub.missingFile")
                                        : z[s].path ?? e("specHub.missingFile"),
                                  }),
                                  (
                                    s === "specs"
                                      ? Ht?.truncated
                                      : z[s].truncated
                                  )
                                    ? t(_e, {
                                        variant: "outline",
                                        children: e("specHub.truncated"),
                                      })
                                    : null,
                                  s === "tasks" &&
                                  (z.tasks.taskProgress?.total ?? 0) > 0
                                    ? t(_e, {
                                        variant: "info",
                                        className: "border-[color-mix(in_srgb,var(--info)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--info)_12%,var(--surface-card))] text-[color:var(--text-stronger)] font-bold",
                                        children: e("specHub.taskProgress", {
                                          checked:
                                            z.tasks.taskProgress?.checked ?? 0,
                                          total:
                                            z.tasks.taskProgress?.total ?? 0,
                                        }),
                                      })
                                    : null,
                                  s === "tasks" &&
                                  (z.tasks.taskProgress?.requiredTotal ?? 0) > 0
                                    ? t(_e, {
                                        variant: "info",
                                        className: "border-[color-mix(in_srgb,var(--info)_35%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--info)_12%,var(--surface-card))] text-[color:var(--text-stronger)] font-bold",
                                        children: e(
                                          "specHub.taskProgressRequired",
                                          {
                                            checked:
                                              z.tasks.taskProgress
                                                ?.requiredChecked ?? 0,
                                            total:
                                              z.tasks.taskProgress
                                                ?.requiredTotal ?? 0,
                                          }
                                        ),
                                      })
                                    : null,
                                ],
                              }),
                              t("div", {
                                className: "spec-hub-artifact-body flex-1 min-h-0 flex overflow-auto border border-[color:var(--border-subtle)] rounded-lg bg-[color:var(--surface-command)]",
                                children: (
                                  s === "specs"
                                    ? Ht?.content ?? z[s].content
                                    : z[s].content
                                )
                                  ? s === "tasks" && An.length > 0
                                    ? n("div", {
                                        className:
                                          "spec-hub-markdown markdown spec-hub-task-list",
                                        children: [
                                          t("p", {
                                            className: "spec-hub-task-rule",
                                            children: e(
                                              "specHub.tasksEditableRule"
                                            ),
                                          }),
                                          ie
                                            ? t("p", {
                                                className:
                                                  "spec-hub-task-readonly-hint",
                                                children: e(
                                                  "specHub.tasksReadonlyDuringAction"
                                                ),
                                              })
                                            : null,
                                          Ua
                                            ? t("p", {
                                                className:
                                                  "spec-hub-task-readonly-hint",
                                                children: e(
                                                  "specHub.tasksUpdating"
                                                ),
                                              })
                                            : null,
                                          bo.map((o) => {
                                            if (o.kind === "blank")
                                              return t(
                                                "div",
                                                {
                                                  className:
                                                    "spec-hub-task-blank",
                                                  "aria-hidden": !0,
                                                },
                                                o.key
                                              );
                                            if (o.kind === "heading")
                                              return t(
                                                "p",
                                                {
                                                  className: `spec-hub-task-heading level-${Math.min(
                                                    o.level,
                                                    4
                                                  )}`,
                                                  children: o.text,
                                                },
                                                o.key
                                              );
                                            if (o.kind === "task") {
                                              const r = Ua || ie !== null;
                                              return n(
                                                "label",
                                                {
                                                  className: `spec-hub-task-row ${
                                                    r ? "is-disabled" : ""
                                                  }`,
                                                  children: [
                                                    t("input", {
                                                      type: "checkbox",
                                                      className: `spec-hub-task-checkbox ${
                                                        o.item.index === Ba
                                                          ? "is-updating"
                                                          : ""
                                                      }`,
                                                      checked: o.item.checked,
                                                      disabled: r,
                                                      onChange: () => {
                                                        io(
                                                          o.item.index,
                                                          !o.item.checked
                                                        );
                                                      },
                                                    }),
                                                    t("span", {
                                                      className:
                                                        "spec-hub-task-text",
                                                      children: qn(o.item.text),
                                                    }),
                                                  ],
                                                },
                                                o.key
                                              );
                                            }
                                            return o.kind === "task-note"
                                              ? t(
                                                  "p",
                                                  {
                                                    className:
                                                      "spec-hub-task-note",
                                                    children: qn(o.text),
                                                  },
                                                  o.key
                                                )
                                              : t(
                                                  "p",
                                                  {
                                                    className:
                                                      "spec-hub-task-raw",
                                                    children: qn(o.text),
                                                  },
                                                  o.key
                                                );
                                          }),
                                          _a
                                            ? n("p", {
                                                className:
                                                  "spec-hub-action-error",
                                                children: [
                                                  t(J, {
                                                    size: 14,
                                                    "aria-hidden": !0,
                                                  }),
                                                  t("span", {
                                                    children: V(_a, e),
                                                  }),
                                                ],
                                              })
                                            : null,
                                        ],
                                      })
                                    : t(Lc, {
                                        value:
                                          s === "specs"
                                            ? Ht?.content ?? z[s].content
                                            : z[s].content,
                                        className: "spec-hub-markdown markdown",
                                        codeBlockStyle: "message",
                                      })
                                  : n("div", {
                                      className: "spec-hub-empty-state",
                                      children: [
                                        t(qt, { size: 18, "aria-hidden": !0 }),
                                        t("p", {
                                          className:
                                            "spec-hub-empty-state-title",
                                          children: e("specHub.emptyArtifact"),
                                        }),
                                        t("p", {
                                          className:
                                            "spec-hub-empty-state-desc",
                                          children: e(
                                            "specHub.emptyArtifactHint"
                                          ),
                                        }),
                                      ],
                                    }),
                              }),
                            ],
                          },
                          s
                        )
                      ),
                    ],
                  })
                : n("div", {
                    className: "spec-hub-empty-state is-panel",
                    children: [
                      t(qt, { size: 18, "aria-hidden": !0 }),
                      t("p", {
                        className: "spec-hub-empty-state-title",
                        children: e("specHub.selectChange"),
                      }),
                      t("p", {
                        className: "spec-hub-empty-state-desc",
                        children: e("specHub.selectChangeHint"),
                      }),
                    ],
                  }),
            ],
          }),
          n("aside", {
            className: "spec-hub-control border border-[color:var(--border-muted)] bg-card rounded-[10px] min-h-0 overflow-hidden flex flex-col",
            children: [
              t("div", {
                className: "spec-hub-panel-header px-2.5 py-2 border-b border-[color:var(--border-subtle)] flex items-center justify-between gap-2",
                children: n("div", {
                  className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                  children: [
                    t(Fn, { size: 14, "aria-hidden": !0 }),
                    t("span", { children: e("specHub.controlCenter") }),
                  ],
                }),
              }),
              n(fi, {
                value: G,
                onValueChange: (s) => {
                  Z(s);
                },
                className: "spec-hub-control-tabs min-h-0 flex flex-col flex-1 [&_[role='tablist']]:mx-2.5 [&_[role='tablist']]:mt-2 [&_[role='tablist']]:mb-0 [&_[role='tablist']]:flex [&_[role='tablist']]:flex-nowrap [&_[role='tablist']]:items-center [&_[role='tablist']]:w-[calc(100%-20px)] [&_[role='tablist']]:max-w-[calc(100%-20px)] [&_[role='tablist']]:gap-1.5 [&_[role='tablist']]:overflow-x-hidden [&_[role='tablist']]:p-0.5 [&_[role='tablist']]:bg-[color:var(--surface-item)] [&_[role='tablist']]:border [&_[role='tablist']]:border-[color:var(--border-subtle)] [&_[role='tablist']]:rounded-[10px] [&_[role='tablist']]:box-border [&_[role='tab']]:flex-1 [&_[role='tab']]:min-w-0 [&_[role='tab']]:inline-flex [&_[role='tab']]:items-center [&_[role='tab']]:justify-center [&_[role='tab']]:gap-1.5 [&_[role='tab']]:px-2.5 [&_[role='tab']]:py-1.5 [&_[role='tab']]:rounded-lg [&_[role='tab']]:text-[12px] [&_[role='tab']]:font-semibold",
                children: [
                  n(vi, {
                    children: [
                      n(we, {
                        value: "project",
                        title: e("specHub.project"),
                        "aria-label": e("specHub.project"),
                        children: [
                          t(Se, { size: 13, "aria-hidden": !0 }),
                          t("span", { children: e("specHub.project") }),
                        ],
                      }),
                      n(we, {
                        value: "actions",
                        title: e("specHub.actions"),
                        "aria-label": e("specHub.actions"),
                        children: [
                          t(Fn, { size: 13, "aria-hidden": !0 }),
                          t("span", { children: e("specHub.actions") }),
                        ],
                      }),
                      n(we, {
                        value: "gate",
                        title: e("specHub.gateTitle"),
                        "aria-label": e("specHub.gateTitle"),
                        children: [
                          t(Ln, { size: 13, "aria-hidden": !0 }),
                          t("span", { children: e("specHub.gateTitle") }),
                        ],
                      }),
                      n(we, {
                        value: "timeline",
                        title: e("specHub.timeline"),
                        "aria-label": e("specHub.timeline"),
                        children: [
                          t(vc, { size: 13, "aria-hidden": !0 }),
                          t("span", { children: e("specHub.timeline") }),
                        ],
                      }),
                    ],
                  }),
                  n(Xt, {
                    value: "actions",
                    className: "spec-hub-control-content min-h-0 flex-1 flex flex-col gap-2 p-2.5 overflow-auto",
                    children: [
                      n("div", {
                        className: "spec-hub-action-stack min-h-0 flex flex-col gap-2",
                        children: [
                          n("section", {
                            className: "spec-hub-action-orchestrator",
                            children: [
                              n("header", {
                                className: "spec-hub-action-orchestrator-head",
                                children: [
                                  t("span", {
                                    className:
                                      "spec-hub-action-orchestrator-head-icon",
                                    "aria-hidden": !0,
                                    children: t(Fn, { size: 14 }),
                                  }),
                                  n("div", {
                                    className:
                                      "spec-hub-action-orchestrator-head-copy",
                                    children: [
                                      t("h4", {
                                        children: e(
                                          "specHub.actionCenterTitle"
                                        ),
                                      }),
                                      t("p", {
                                        className:
                                          "spec-hub-action-orchestrator-head-hint",
                                        children: e("specHub.actionCenterHint"),
                                      }),
                                    ],
                                  }),
                                ],
                              }),
                              n("div", {
                                className: "spec-hub-shared-engine",
                                children: [
                                  n("div", {
                                    className:
                                      "spec-hub-action-orchestrator-row",
                                    children: [
                                      n("div", {
                                        className:
                                          "spec-hub-shared-engine-select-wrap",
                                        children: [
                                          t("span", {
                                            className:
                                              "spec-hub-shared-engine-icon",
                                            "aria-hidden": !0,
                                            children: t(Ti, {
                                              engine: S,
                                              size: 15,
                                            }),
                                          }),
                                          t("select", {
                                            id: "spec-hub-shared-agent",
                                            "aria-label": e(
                                              "specHub.sharedExecutor.label"
                                            ),
                                            value: S,
                                            disabled: Ts || Kn,
                                            onChange: (s) => {
                                              const o = s.target.value;
                                              Vn(o) && Ae(o);
                                            },
                                            children: qo.map((s) =>
                                              t(
                                                "option",
                                                {
                                                  value: s.engine,
                                                  disabled: !s.installed,
                                                  children: s.label,
                                                },
                                                `shared-agent-${s.engine}`
                                              )
                                            ),
                                          }),
                                          t("span", {
                                            className:
                                              "spec-hub-shared-engine-chevron",
                                            "aria-hidden": !0,
                                            children: t($n, { size: 14 }),
                                          }),
                                        ],
                                      }),
                                      n("div", {
                                        className: "spec-hub-action-icon-group",
                                        role: "group",
                                        "aria-label": e(
                                          "specHub.actionCenterTitle"
                                        ),
                                        children: [
                                          t("button", {
                                            type: "button",
                                            className:
                                              "spec-hub-action-icon-button",
                                            disabled: Ts || He,
                                            onClick: () => ui("create"),
                                            "aria-label": e(
                                              "specHub.proposal.createAction"
                                            ),
                                            title: e(
                                              "specHub.proposal.createAction"
                                            ),
                                            children: t(wc, {
                                              size: 16,
                                              "aria-hidden": !0,
                                            }),
                                          }),
                                          t("button", {
                                            type: "button",
                                            className:
                                              "spec-hub-action-icon-button",
                                            disabled:
                                              le.length === 0 ||
                                              $?.status === "archived" ||
                                              Ts ||
                                              He,
                                            onClick: () => ui("append"),
                                            "aria-label": e(
                                              "specHub.proposal.appendAction"
                                            ),
                                            title: e(
                                              "specHub.proposal.appendAction"
                                            ),
                                            children: t(Yt, {
                                              size: 16,
                                              "aria-hidden": !0,
                                            }),
                                          }),
                                        ],
                                      }),
                                    ],
                                  }),
                                  t("p", {
                                    className: "spec-hub-shared-engine-hint",
                                    children: e("specHub.sharedExecutor.hint"),
                                  }),
                                ],
                              }),
                            ],
                          }),
                          $ && kt.length > 0
                            ? n("div", {
                                className: "spec-hub-action-list flex-1 min-h-0 flex flex-col gap-2 overflow-auto p-0",
                                children: [
                                  kt.map((s) => {
                                    const o = Pi[s.key],
                                      r = s.blockers.length > dr,
                                      l = r && da[s.key] !== !0,
                                      b = da[s.key] === !0,
                                      d = l
                                        ? s.blockers.slice(0, er)
                                        : s.blockers,
                                      h = s.blockers.length - d.length,
                                      m = Nr(s.key, s.blockers, e);
                                    return n(
                                      "div",
                                      {
                                        className: "spec-hub-action-item",
                                        children: [
                                          n("button", {
                                            type: "button",
                                            className: "spec-hub-action-button",
                                            disabled: !s.available || tt,
                                            onClick: () => {
                                              Pn(s.key);
                                            },
                                            title:
                                              s.kind === "passthrough"
                                                ? e("specHub.passthroughHint")
                                                : void 0,
                                            children: [
                                              t(o, {
                                                size: 16,
                                                "aria-hidden": !0,
                                              }),
                                              t("span", {
                                                children: e(
                                                  `specHub.action.${s.key}`,
                                                  { defaultValue: s.label }
                                                ),
                                              }),
                                            ],
                                          }),
                                          t("code", {
                                            children: s.commandPreview,
                                          }),
                                          s.key === "continue"
                                            ? n(Ms, {
                                                children: [
                                                  n("label", {
                                                    className: `spec-hub-action-inline-toggle ${
                                                      tt ? "is-disabled" : ""
                                                    }`,
                                                    children: [
                                                      t("input", {
                                                        type: "checkbox",
                                                        checked: us,
                                                        disabled: tt,
                                                        onChange: (f) => {
                                                          ka(f.target.checked),
                                                            re((R) => ({
                                                              ...R,
                                                              error: null,
                                                            }));
                                                        },
                                                        "aria-label": e(
                                                          "specHub.continueAiEnhancement.label"
                                                        ),
                                                      }),
                                                      t("span", {
                                                        children: e(
                                                          "specHub.continueAiEnhancement.label"
                                                        ),
                                                      }),
                                                    ],
                                                  }),
                                                  us
                                                    ? t("p", {
                                                        className:
                                                          "spec-hub-action-inline-hint",
                                                        children: e(
                                                          "specHub.continueAiEnhancement.hint"
                                                        ),
                                                      })
                                                    : null,
                                                ],
                                              })
                                            : null,
                                          s.key === "apply"
                                            ? Ct
                                              ? n(Ms, {
                                                  children: [
                                                    n("label", {
                                                      className: `spec-hub-action-inline-toggle ${
                                                        tt ? "is-disabled" : ""
                                                      }`,
                                                      children: [
                                                        t("input", {
                                                          type: "checkbox",
                                                          checked: ps,
                                                          disabled: tt,
                                                          onChange: (f) => {
                                                            Dt(
                                                              f.target.checked
                                                            );
                                                          },
                                                          "aria-label": e(
                                                            "specHub.applyContinueBrief.label"
                                                          ),
                                                        }),
                                                        t("span", {
                                                          children: e(
                                                            "specHub.applyContinueBrief.label"
                                                          ),
                                                        }),
                                                      ],
                                                    }),
                                                    t("p", {
                                                      className:
                                                        "spec-hub-action-inline-hint",
                                                      children: e(
                                                        "specHub.applyContinueBrief.summary",
                                                        { summary: Ct.summary }
                                                      ),
                                                    }),
                                                    Ho
                                                      ? n("p", {
                                                          className:
                                                            "spec-hub-action-next-step",
                                                          children: [
                                                            t(xe, {
                                                              size: 13,
                                                              "aria-hidden": !0,
                                                            }),
                                                            t("span", {
                                                              children: e(
                                                                "specHub.applyContinueBrief.stale"
                                                              ),
                                                            }),
                                                          ],
                                                        })
                                                      : null,
                                                  ],
                                                })
                                              : t("p", {
                                                  className:
                                                    "spec-hub-action-inline-hint",
                                                  children: e(
                                                    "specHub.applyContinueBrief.missing"
                                                  ),
                                                })
                                            : null,
                                          s.key === "verify"
                                            ? n("label", {
                                                className: `spec-hub-verify-auto-complete ${
                                                  tt ? "is-disabled" : ""
                                                }`,
                                                children: [
                                                  t("input", {
                                                    type: "checkbox",
                                                    checked: rs,
                                                    disabled: tt,
                                                    onChange: (f) => {
                                                      ga(f.target.checked),
                                                        It(null);
                                                    },
                                                    "aria-label": e(
                                                      "specHub.verifyAutoComplete.label"
                                                    ),
                                                  }),
                                                  t("span", {
                                                    children: e(
                                                      "specHub.verifyAutoComplete.label"
                                                    ),
                                                  }),
                                                ],
                                              })
                                            : null,
                                          s.key === "verify" && rs
                                            ? t("p", {
                                                className:
                                                  "spec-hub-verify-auto-complete-hint",
                                                children: e(
                                                  "specHub.verifyAutoComplete.hint"
                                                ),
                                              })
                                            : null,
                                          s.key === "verify" && va && !Sn
                                            ? t("p", {
                                                className: "spec-hub-running",
                                                children: e(
                                                  "specHub.verifyAutoComplete.running"
                                                ),
                                              })
                                            : null,
                                          s.key === "verify" && fa && !Sn
                                            ? n("p", {
                                                className:
                                                  "spec-hub-action-error",
                                                children: [
                                                  t(J, {
                                                    size: 14,
                                                    "aria-hidden": !0,
                                                  }),
                                                  t("span", { children: fa }),
                                                ],
                                              })
                                            : null,
                                          s.blockers.length > 0
                                            ? n("div", {
                                                className:
                                                  "spec-hub-action-blockers",
                                                children: [
                                                  d.map((f) =>
                                                    n(
                                                      "p",
                                                      {
                                                        className: l
                                                          ? "is-collapsed"
                                                          : void 0,
                                                        children: [
                                                          t(xe, {
                                                            size: 13,
                                                            "aria-hidden": !0,
                                                          }),
                                                          t("span", {
                                                            className:
                                                              "spec-hub-action-blocker-text",
                                                            children: V(f, e),
                                                          }),
                                                        ],
                                                      },
                                                      `${s.key}-${f}`
                                                    )
                                                  ),
                                                  r
                                                    ? t("button", {
                                                        type: "button",
                                                        className:
                                                          "ghost spec-hub-action-blockers-toggle",
                                                        onClick: () => {
                                                          ma((f) => ({
                                                            ...f,
                                                            [s.key]: !b,
                                                          }));
                                                        },
                                                        children: b
                                                          ? e(
                                                              "specHub.blockers.collapse"
                                                            )
                                                          : e(
                                                              "specHub.blockers.expand",
                                                              { count: h }
                                                            ),
                                                      })
                                                    : null,
                                                ],
                                              })
                                            : null,
                                          m
                                            ? n("p", {
                                                className:
                                                  "spec-hub-action-next-step",
                                                children: [
                                                  t(Wt, {
                                                    size: 13,
                                                    "aria-hidden": !0,
                                                  }),
                                                  t("span", { children: m }),
                                                ],
                                              })
                                            : null,
                                        ],
                                      },
                                      s.key
                                    );
                                  }),
                                  E.provider === "speckit"
                                    ? n("div", {
                                        className: "spec-hub-passthrough",
                                        children: [
                                          n("button", {
                                            type: "button",
                                            className: "ghost",
                                            onClick: () => {
                                              bc(
                                                "https://github.com/github/spec-kit"
                                              );
                                            },
                                            children: [
                                              t(kc, {
                                                size: 14,
                                                "aria-hidden": !0,
                                              }),
                                              t("span", {
                                                children: e(
                                                  "specHub.openSpecKitDocs"
                                                ),
                                              }),
                                            ],
                                          }),
                                          t("code", {
                                            children: "specify --help",
                                          }),
                                        ],
                                      })
                                    : null,
                                ],
                              })
                            : t("div", {
                                className: "spec-hub-action-list flex-1 min-h-0 flex flex-col gap-2 overflow-auto p-0",
                                children: ko.map(({ key: s }) => {
                                  const o = Pi[s];
                                  return n(
                                    "div",
                                    {
                                      className: "spec-hub-action-item",
                                      children: [
                                        n("button", {
                                          type: "button",
                                          className: "spec-hub-action-button",
                                          disabled: !0,
                                          children: [
                                            t(o, {
                                              size: 16,
                                              "aria-hidden": !0,
                                            }),
                                            t("span", {
                                              children: e(
                                                `specHub.action.${s}`
                                              ),
                                            }),
                                          ],
                                        }),
                                        t("code", { children: fr(s) }),
                                        t("div", {
                                          className: "spec-hub-action-blockers",
                                          children: n("p", {
                                            children: [
                                              t(xe, {
                                                size: 13,
                                                "aria-hidden": !0,
                                              }),
                                              t("span", {
                                                children: e(
                                                  "specHub.runtime.selectChangeFirst"
                                                ),
                                              }),
                                            ],
                                          }),
                                        }),
                                      ],
                                    },
                                    s
                                  );
                                }),
                              }),
                          $ && Je
                            ? n("section", {
                                className: "spec-hub-guidance-result",
                                children: [
                                  n("div", {
                                    className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                                    children: [
                                      t(Rn, { size: 14, "aria-hidden": !0 }),
                                      t("span", {
                                        children: e("specHub.guidance.title"),
                                      }),
                                    ],
                                  }),
                                  n("div", {
                                    className: "spec-hub-guidance-grid",
                                    children: [
                                      n("article", {
                                        className: "spec-hub-guidance-field",
                                        children: [
                                          t("span", {
                                            children: e(
                                              "specHub.guidance.fieldAction"
                                            ),
                                          }),
                                          t("strong", { children: No }),
                                        ],
                                      }),
                                      n("article", {
                                        className: "spec-hub-guidance-field",
                                        children: [
                                          t("span", {
                                            children: e(
                                              "specHub.guidance.fieldStatus"
                                            ),
                                          }),
                                          t("strong", {
                                            className: `is-${te}`,
                                            children: xo,
                                          }),
                                        ],
                                      }),
                                      n("article", {
                                        className: "spec-hub-guidance-field",
                                        children: [
                                          t("span", {
                                            children: e(
                                              "specHub.guidance.fieldTime"
                                            ),
                                          }),
                                          n("strong", {
                                            children: [
                                              So,
                                              te === "running" && Qa
                                                ? ` \xB7 ${e(
                                                    "specHub.aiTakeover.elapsed",
                                                    { duration: Qa }
                                                  )}`
                                                : "",
                                            ],
                                          }),
                                        ],
                                      }),
                                    ],
                                  }),
                                  te === "running"
                                    ? t("p", {
                                        className: "spec-hub-running",
                                        children: e(
                                          "specHub.guidance.runningHint"
                                        ),
                                      })
                                    : te === "success"
                                    ? pe.noSuggestion
                                      ? t("p", {
                                          className: "spec-hub-context-notice",
                                          children: e(
                                            "specHub.guidance.noSuggestion"
                                          ),
                                        })
                                      : t(Ms, {
                                          children: pe.isTemplate
                                            ? n("div", {
                                                className:
                                                  "spec-hub-guidance-template",
                                                children: [
                                                  t("span", {
                                                    children: e(
                                                      "specHub.guidance.templateTitle"
                                                    ),
                                                  }),
                                                  n("ul", {
                                                    children: [
                                                      pe.artifactId
                                                        ? t("li", {
                                                            children: e(
                                                              "specHub.guidance.templateArtifact",
                                                              {
                                                                value:
                                                                  pe.artifactId,
                                                              }
                                                            ),
                                                          })
                                                        : null,
                                                      pe.artifactChange
                                                        ? t("li", {
                                                            children: e(
                                                              "specHub.guidance.templateChange",
                                                              {
                                                                value:
                                                                  pe.artifactChange,
                                                              }
                                                            ),
                                                          })
                                                        : null,
                                                      pe.artifactSchema
                                                        ? t("li", {
                                                            children: e(
                                                              "specHub.guidance.templateSchema",
                                                              {
                                                                value:
                                                                  pe.artifactSchema,
                                                              }
                                                            ),
                                                          })
                                                        : null,
                                                      pe.taskText
                                                        ? t("li", {
                                                            children: e(
                                                              "specHub.guidance.templateTask",
                                                              {
                                                                value:
                                                                  pe.taskText,
                                                              }
                                                            ),
                                                          })
                                                        : null,
                                                    ],
                                                  }),
                                                ],
                                              })
                                            : n("div", {
                                                className:
                                                  "spec-hub-guidance-highlights",
                                                children: [
                                                  t("span", {
                                                    children: e(
                                                      "specHub.guidance.summaryTitle"
                                                    ),
                                                  }),
                                                  t("ul", {
                                                    children: pe.highlights.map(
                                                      (s, o) =>
                                                        t(
                                                          "li",
                                                          { children: s },
                                                          `guidance-highlight-${o}`
                                                        )
                                                    ),
                                                  }),
                                                ],
                                              }),
                                        })
                                    : te === "failed"
                                    ? n("p", {
                                        className: "spec-hub-action-error",
                                        children: [
                                          t(J, { size: 14, "aria-hidden": !0 }),
                                          t("span", {
                                            children: e(
                                              "specHub.guidance.failedHint"
                                            ),
                                          }),
                                        ],
                                      })
                                    : t("p", {
                                        className: "spec-hub-running",
                                        children: e(
                                          "specHub.guidance.idleHint"
                                        ),
                                      }),
                                  (te === "success" || te === "failed") && Qe
                                    ? n("div", {
                                        className: "spec-hub-guidance-next",
                                        children: [
                                          t("span", {
                                            children: e(
                                              "specHub.guidance.nextTitle"
                                            ),
                                          }),
                                          n("button", {
                                            type: "button",
                                            className: "spec-hub-action-button",
                                            disabled:
                                              !Qe.available || ie !== null,
                                            onClick: () => {
                                              Pn(Qe.key);
                                            },
                                            children: [
                                              t(Wt, {
                                                size: 16,
                                                "aria-hidden": !0,
                                              }),
                                              t("span", {
                                                children: e(
                                                  "specHub.guidance.nextAction",
                                                  {
                                                    action: e(
                                                      `specHub.action.${Qe.key}`
                                                    ),
                                                  }
                                                ),
                                              }),
                                            ],
                                          }),
                                          !Qe.available &&
                                          Qe.blockers.length > 0
                                            ? t("div", {
                                                className:
                                                  "spec-hub-action-blockers",
                                                children: n("p", {
                                                  children: [
                                                    t(xe, {
                                                      size: 13,
                                                      "aria-hidden": !0,
                                                    }),
                                                    t("span", {
                                                      children: V(
                                                        Qe.blockers[0] ?? "",
                                                        e
                                                      ),
                                                    }),
                                                  ],
                                                }),
                                              })
                                            : null,
                                        ],
                                      })
                                    : null,
                                  (te === "success" || te === "failed") && Ze
                                    ? n("div", {
                                        className: "spec-hub-guidance-controls",
                                        children: [
                                          Je
                                            ? t("button", {
                                                type: "button",
                                                className: "ghost",
                                                disabled: ie !== null,
                                                onClick: () => {
                                                  Pn(Je);
                                                },
                                                children: e(
                                                  "specHub.guidance.retry"
                                                ),
                                              })
                                            : null,
                                          t("button", {
                                            type: "button",
                                            className: "ghost",
                                            onClick: () => pa((s) => !s),
                                            children: e(
                                              en
                                                ? "specHub.guidance.hideRaw"
                                                : "specHub.guidance.showRaw"
                                            ),
                                          }),
                                          en && ks.removedTags.length > 0
                                            ? t("button", {
                                                type: "button",
                                                className: "ghost",
                                                onClick: () => tn((s) => !s),
                                                children: e(
                                                  is
                                                    ? "specHub.guidance.useCompactRaw"
                                                    : "specHub.guidance.showFullRaw"
                                                ),
                                              })
                                            : null,
                                        ],
                                      })
                                    : null,
                                  en && Ze
                                    ? n("div", {
                                        className:
                                          "spec-hub-command-preview spec-hub-guidance-raw",
                                        children: [
                                          n("span", {
                                            children: [
                                              e(
                                                "specHub.guidance.rawOutputTitle"
                                              ),
                                              is
                                                ? ` \xB7 ${e(
                                                    "specHub.guidance.rawModeFull"
                                                  )}`
                                                : ` \xB7 ${e(
                                                    "specHub.guidance.rawModeCompact"
                                                  )}`,
                                            ],
                                          }),
                                          t("code", { children: Co }),
                                          !is && ks.removedTags.length > 0
                                            ? t("p", {
                                                className:
                                                  "spec-hub-guidance-raw-hint",
                                                children: e(
                                                  "specHub.guidance.rawCollapsedHint",
                                                  {
                                                    sections:
                                                      ks.removedTags.join(", "),
                                                  }
                                                ),
                                              })
                                            : null,
                                        ],
                                      })
                                    : null,
                                ],
                              })
                            : null,
                          Eo
                            ? n("section", {
                                className: "spec-hub-ai-takeover",
                                children: [
                                  n("div", {
                                    className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                                    children: [
                                      t(Se, { size: 14, "aria-hidden": !0 }),
                                      t("span", {
                                        children: e("specHub.aiTakeover.title"),
                                      }),
                                    ],
                                  }),
                                  t("p", {
                                    className: "spec-hub-bootstrap-desc",
                                    children: e(
                                      "specHub.aiTakeover.description"
                                    ),
                                  }),
                                  n("div", {
                                    className: "spec-hub-command-preview",
                                    children: [
                                      t("span", {
                                        children: e(
                                          "specHub.aiTakeover.agentLabel"
                                        ),
                                      }),
                                      t("code", { children: q(S) }),
                                    ],
                                  }),
                                  n("label", {
                                    className:
                                      "spec-hub-ai-takeover-auto-archive",
                                    children: [
                                      t("input", {
                                        type: "checkbox",
                                        checked: na,
                                        disabled: He || Us,
                                        onChange: (s) => aa(s.target.checked),
                                      }),
                                      t("span", {
                                        children: e(
                                          "specHub.aiTakeover.autoArchiveLabel"
                                        ),
                                      }),
                                    ],
                                  }),
                                  ys
                                    ? n("div", {
                                        className: "spec-hub-command-preview",
                                        children: [
                                          t("span", {
                                            children: e(
                                              "specHub.aiTakeover.latestArchiveOutput"
                                            ),
                                          }),
                                          t("code", { children: ys }),
                                        ],
                                      })
                                    : null,
                                  n("button", {
                                    type: "button",
                                    className: "spec-hub-action-button",
                                    disabled: He || ie !== null || Us || et,
                                    onClick: () => {
                                      uc();
                                    },
                                    children: [
                                      t(Se, { size: 16, "aria-hidden": !0 }),
                                      t("span", {
                                        children: e(
                                          He || Us
                                            ? "specHub.aiTakeover.running"
                                            : "specHub.aiTakeover.action"
                                        ),
                                      }),
                                    ],
                                  }),
                                ],
                              })
                            : null,
                        ],
                      }),
                      ie
                        ? t("p", {
                            className: "spec-hub-running",
                            children: e("specHub.runningAction"),
                          })
                        : null,
                      za
                        ? n("p", {
                            className: "spec-hub-action-error",
                            children: [
                              t(J, { size: 14, "aria-hidden": !0 }),
                              t("span", { children: V(za, e) }),
                            ],
                          })
                        : null,
                    ],
                  }),
                  t(Xt, {
                    value: "project",
                    className: "spec-hub-control-content min-h-0 flex-1 flex flex-col gap-2 p-2.5 overflow-auto",
                    children: go
                      ? n("div", {
                          className: "spec-hub-project-stack",
                          children: [
                            n("section", {
                              className:
                                "spec-hub-bootstrap-panel spec-hub-project-card",
                              children: [
                                n("header", {
                                  className: "spec-hub-bootstrap-card-head",
                                  children: [
                                    n("div", {
                                      className:
                                        "spec-hub-bootstrap-card-title",
                                      children: [
                                        t(Se, { size: 14, "aria-hidden": !0 }),
                                        t("span", {
                                          children: e(
                                            "specHub.bootstrap.specRootTitle"
                                          ),
                                        }),
                                      ],
                                    }),
                                    t("p", {
                                      className: "spec-hub-bootstrap-desc",
                                      children: e(
                                        "specHub.bootstrap.specRootDescription"
                                      ),
                                    }),
                                  ],
                                }),
                                n("div", {
                                  className: "spec-hub-form-field",
                                  children: [
                                    t("label", {
                                      htmlFor: "spec-hub-spec-root-input",
                                      children: e(
                                        "specHub.bootstrap.specRootLabel"
                                      ),
                                    }),
                                    t("input", {
                                      id: "spec-hub-spec-root-input",
                                      type: "text",
                                      value: ta,
                                      onChange: (s) => zs(s.target.value),
                                      placeholder: e(
                                        "specHub.bootstrap.specRootPlaceholder"
                                      ),
                                      disabled: Tt,
                                    }),
                                  ],
                                }),
                                t("p", {
                                  className: "spec-hub-bootstrap-root-current",
                                  children: e(
                                    "specHub.bootstrap.specRootCurrent",
                                    {
                                      path: ze,
                                      source: e(
                                        vo
                                          ? "specHub.bootstrap.specRootSourceCustom"
                                          : "specHub.bootstrap.specRootSourceDefault"
                                      ),
                                    }
                                  ),
                                }),
                                n("div", {
                                  className: "spec-hub-bootstrap-root-actions",
                                  children: [
                                    t("button", {
                                      type: "button",
                                      className:
                                        "ghost spec-hub-bootstrap-inline-action",
                                      onClick: () => {
                                        pc();
                                      },
                                      disabled: Tt,
                                      children: e(
                                        "specHub.bootstrap.specRootSave"
                                      ),
                                    }),
                                    t("button", {
                                      type: "button",
                                      className:
                                        "ghost spec-hub-bootstrap-inline-action",
                                      onClick: () => {
                                        dc();
                                      },
                                      disabled: Tt,
                                      children: e(
                                        "specHub.bootstrap.specRootReset"
                                      ),
                                    }),
                                  ],
                                }),
                              ],
                            }),
                            n("section", {
                              className:
                                "spec-hub-bootstrap-panel spec-hub-project-card is-context",
                              children: [
                                n("header", {
                                  className: "spec-hub-bootstrap-card-head",
                                  children: [
                                    n("div", {
                                      className:
                                        "spec-hub-bootstrap-card-title",
                                      children: [
                                        t(Se, { size: 14, "aria-hidden": !0 }),
                                        t("span", {
                                          children: e(
                                            ve
                                              ? "specHub.bootstrap.title"
                                              : "specHub.bootstrap.projectInfoTitle"
                                          ),
                                        }),
                                      ],
                                    }),
                                    t("p", {
                                      className: "spec-hub-bootstrap-desc",
                                      children: e(
                                        ve
                                          ? "specHub.bootstrap.description"
                                          : "specHub.bootstrap.projectInfoDescription"
                                      ),
                                    }),
                                  ],
                                }),
                                n("div", {
                                  className: "spec-hub-auto-profile",
                                  children: [
                                    t("label", {
                                      htmlFor: "spec-hub-profile-select",
                                      children: e(
                                        "specHub.bootstrap.agentLabel"
                                      ),
                                    }),
                                    n("div", {
                                      className:
                                        "spec-hub-auto-profile-select-wrap",
                                      children: [
                                        t("span", {
                                          className:
                                            "spec-hub-auto-profile-select-icon",
                                          "aria-hidden": !0,
                                          children: t(Ti, {
                                            engine: ht,
                                            size: 15,
                                          }),
                                        }),
                                        t("select", {
                                          id: "spec-hub-profile-select",
                                          value: ht,
                                          onChange: (s) => Q(s.target.value),
                                          disabled: Tt || Kn || et,
                                          children: Xo.map((s) =>
                                            t(
                                              "option",
                                              {
                                                value: s.engine,
                                                disabled: !s.installed,
                                                children: s.label,
                                              },
                                              s.engine
                                            )
                                          ),
                                        }),
                                        t("span", {
                                          className:
                                            "spec-hub-auto-profile-select-chevron",
                                          "aria-hidden": !0,
                                          children: t($n, { size: 14 }),
                                        }),
                                      ],
                                    }),
                                    t("p", {
                                      className:
                                        "spec-hub-bootstrap-inline-hint",
                                      children: e(
                                        "specHub.bootstrap.agentHint"
                                      ),
                                    }),
                                  ],
                                }),
                                t("div", {
                                  className: "spec-hub-auto-preview",
                                  children: gt
                                    ? n(Ms, {
                                        children: [
                                          t("p", {
                                            children: e(
                                              "specHub.bootstrap.previewTitle"
                                            ),
                                          }),
                                          n("ul", {
                                            children: [
                                              t("li", {
                                                children: e(
                                                  "specHub.bootstrap.previewType",
                                                  {
                                                    type: e(
                                                      `specHub.bootstrap.typeValue.${gt.projectType}`
                                                    ),
                                                  }
                                                ),
                                              }),
                                              t("li", {
                                                children: e(
                                                  "specHub.bootstrap.previewDomain",
                                                  { value: gt.domain }
                                                ),
                                              }),
                                              t("li", {
                                                children: e(
                                                  "specHub.bootstrap.previewArchitecture",
                                                  { value: gt.architecture }
                                                ),
                                              }),
                                              t("li", {
                                                children: e(
                                                  "specHub.bootstrap.previewConstraints",
                                                  { value: gt.constraints }
                                                ),
                                              }),
                                              t("li", {
                                                children: e(
                                                  "specHub.bootstrap.previewOwners",
                                                  { value: gt.owners }
                                                ),
                                              }),
                                            ],
                                          }),
                                        ],
                                      })
                                    : t("p", {
                                        children: e(
                                          "specHub.bootstrap.previewPending"
                                        ),
                                      }),
                                }),
                                n("div", {
                                  className:
                                    "spec-hub-command-preview spec-hub-command-preview-compact",
                                  children: [
                                    t("span", {
                                      children: e(
                                        ve
                                          ? "specHub.bootstrap.bootstrapCommand"
                                          : "specHub.bootstrap.projectInfoCommand"
                                      ),
                                    }),
                                    t("code", { children: fo }),
                                  ],
                                }),
                                n("button", {
                                  type: "button",
                                  className: "spec-hub-action-button",
                                  onClick: () => {
                                    Qo();
                                  },
                                  disabled: Tt || et,
                                  children: [
                                    t(Se, { size: 16, "aria-hidden": !0 }),
                                    t("span", {
                                      children: e(
                                        Tt
                                          ? "specHub.bootstrap.generatingByAgent"
                                          : ve
                                          ? "specHub.bootstrap.generateAndBootstrapAction"
                                          : "specHub.bootstrap.generateAndSaveAction"
                                      ),
                                    }),
                                  ],
                                }),
                                Va
                                  ? n("p", {
                                      className: "spec-hub-action-error",
                                      children: [
                                        t(J, { size: 14, "aria-hidden": !0 }),
                                        t("span", { children: V(Va, e) }),
                                      ],
                                    })
                                  : null,
                                ea
                                  ? t("p", {
                                      className:
                                        "spec-hub-running spec-hub-context-notice",
                                      children: ea,
                                    })
                                  : null,
                              ],
                            }),
                            n("section", {
                              className:
                                "spec-hub-bootstrap-panel spec-hub-project-card",
                              children: [
                                n("header", {
                                  className:
                                    "spec-hub-bootstrap-card-head spec-hub-doctor-card-head",
                                  children: [
                                    n("div", {
                                      className:
                                        "spec-hub-bootstrap-card-title",
                                      children: [
                                        t(Cc, { size: 14, "aria-hidden": !0 }),
                                        t("span", {
                                          children: e("specHub.doctorTitle"),
                                        }),
                                      ],
                                    }),
                                    n("div", {
                                      className: "spec-hub-mode-switch inline-flex border border-[color:var(--border-muted)] rounded-full overflow-hidden",
                                      role: "group",
                                      "aria-label": e("specHub.modeTitle"),
                                      children: [
                                        t("button", {
                                          type: "button",
                                          className: `ghost ${
                                            fs === "managed" ? "is-active" : ""
                                          } border-0 rounded-none px-[9px] py-[3px] text-[11px]${fs === "managed" ? " bg-[color:var(--surface-control-hover)] text-[color:var(--text-stronger)]" : ""}`,
                                          onClick: () => Ga("managed"),
                                          children: e("specHub.modeManaged"),
                                        }),
                                        t("button", {
                                          type: "button",
                                          className: `ghost ${
                                            fs === "byo" ? "is-active" : ""
                                          } border-0 rounded-none px-[9px] py-[3px] text-[11px]${fs === "byo" ? " bg-[color:var(--surface-control-hover)] text-[color:var(--text-stronger)]" : ""}`,
                                          onClick: () => Ga("byo"),
                                          children: e("specHub.modeByo"),
                                        }),
                                      ],
                                    }),
                                  ],
                                }),
                                n("div", {
                                  className: "spec-hub-doctor-content p-2 grid [grid-template-columns:minmax(0,1fr)] gap-2",
                                  children: [
                                    t("div", {
                                      className: "spec-hub-doctor-checks flex flex-col gap-1.5",
                                      children: E.environment.checks.map((s) =>
                                        t(
                                          "article",
                                          {
                                            className: `spec-hub-check-item ${
                                              s.ok ? "ok" : "fail"
                                            } border rounded-lg bg-[color-mix(in_srgb,var(--surface-item)_86%,var(--surface-card))] p-2${s.ok ? " border-[color-mix(in_srgb,var(--success)_35%,var(--border-subtle))]" : " border-[color-mix(in_srgb,var(--danger)_35%,var(--border-subtle))]"}`,
                                            children: n("div", {
                                              className: "spec-hub-check-row grid [grid-template-columns:minmax(84px,0.9fr)_minmax(0,1fr)_auto] items-center gap-2",
                                              children: [
                                                t("span", {
                                                  className:
                                                    "spec-hub-check-label text-[12px] font-semibold text-[color:var(--text-secondary)] whitespace-nowrap overflow-hidden text-ellipsis",
                                                  children: e(
                                                    `specHub.check.${s.key}`,
                                                    { defaultValue: s.label }
                                                  ),
                                                }),
                                                t("code", {
                                                  className: "m-0 text-[11px] border border-[color:var(--border-subtle)] rounded-[6px] bg-[color-mix(in_srgb,var(--surface-command)_82%,transparent)] text-[color:var(--text-secondary)] px-1.5 py-0.5 whitespace-nowrap overflow-hidden text-ellipsis",
                                                  title: V(s.detail, e),
                                                  children: V(s.detail, e),
                                                }),
                                                t(_e, {
                                                  className: "justify-self-end whitespace-nowrap",
                                                  variant: s.ok
                                                    ? "secondary"
                                                    : "warning",
                                                  children: s.ok
                                                    ? e("specHub.healthOk")
                                                    : e(
                                                        "specHub.healthMissing"
                                                      ),
                                                }),
                                              ],
                                            }),
                                          },
                                          s.key
                                        )
                                      ),
                                    }),
                                    (E.environment.blockers.length > 0 ||
                                      E.environment.hints.length > 0) &&
                                      n("div", {
                                        className: "spec-hub-doctor-hints border border-dashed border-[color:var(--border-muted)] rounded-lg bg-[color-mix(in_srgb,var(--surface-command)_60%,transparent)] p-1.5 flex flex-col gap-1 max-h-[60px] overflow-auto",
                                        children: [
                                          E.environment.blockers.map((s) =>
                                            n(
                                              "p",
                                              {
                                                className: "m-0 inline-flex items-start gap-1.5 text-[11px] text-[color:var(--text-secondary)]",
                                                children: [
                                                  t(gi, {
                                                    size: 13,
                                                    "aria-hidden": !0,
                                                  }),
                                                  t("span", {
                                                    children: V(s, e),
                                                  }),
                                                ],
                                              },
                                              s
                                            )
                                          ),
                                          E.environment.hints.map((s) =>
                                            n(
                                              "p",
                                              {
                                                className: "is-hint m-0 inline-flex items-start gap-1.5 text-[11px] text-[color:var(--text-muted)]",
                                                children: [
                                                  t(xe, {
                                                    size: 13,
                                                    "aria-hidden": !0,
                                                  }),
                                                  t("span", {
                                                    children: V(s, e),
                                                  }),
                                                ],
                                              },
                                              s
                                            )
                                          ),
                                        ],
                                      }),
                                  ],
                                }),
                              ],
                            }),
                          ],
                        })
                      : n("div", {
                          className: "spec-hub-empty-state is-panel",
                          children: [
                            t(qt, { size: 18, "aria-hidden": !0 }),
                            t("p", {
                              className: "spec-hub-empty-state-title",
                              children: e("specHub.bootstrap.projectInfoTitle"),
                            }),
                            t("p", {
                              className: "spec-hub-empty-state-desc",
                              children: e("specHub.bootstrap.unsupported"),
                            }),
                          ],
                        }),
                  }),
                  n(Xt, {
                    value: "gate",
                    className: "spec-hub-control-content min-h-0 flex-1 flex flex-col gap-2 p-2.5 overflow-auto",
                    children: [
                      Ma.length > 0
                        ? n("div", {
                            className: "spec-hub-validation-panel",
                            children: [
                              n("div", {
                                className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                                children: [
                                  t(gi, { size: 14, "aria-hidden": !0 }),
                                  t("span", {
                                    children: e("specHub.validationPanel"),
                                  }),
                                ],
                              }),
                              t("div", {
                                className: "spec-hub-validation-list",
                                children: Ma.map((s, o) =>
                                  n(
                                    "button",
                                    {
                                      type: "button",
                                      className: "spec-hub-validation-item",
                                      onClick: () => mc(s.path),
                                      children: [
                                        t("strong", {
                                          children: V(s.target, e),
                                        }),
                                        t("span", { children: s.reason }),
                                        t("small", { children: V(s.hint, e) }),
                                      ],
                                    },
                                    `${s.target}-${o}`
                                  )
                                ),
                              }),
                            ],
                          })
                        : null,
                      t("div", {
                        className: "spec-hub-gate-panel",
                        children: t("div", {
                          className: "spec-hub-gate-checks",
                          children: Ye.checks.map((s) =>
                            n(
                              "article",
                              {
                                className: `spec-hub-gate-check ${s.status}`,
                                children: [
                                  n("header", {
                                    children: [
                                      t("span", {
                                        children: e(
                                          `specHub.gateCheck.${s.key}`,
                                          { defaultValue: s.label }
                                        ),
                                      }),
                                      t(_e, {
                                        variant:
                                          s.status === "pass"
                                            ? "secondary"
                                            : s.status === "warn"
                                            ? "warning"
                                            : "destructive",
                                        children: e(`specHub.gate.${s.status}`),
                                      }),
                                    ],
                                  }),
                                  t("p", { children: V(s.message, e) }),
                                ],
                              },
                              s.key
                            )
                          ),
                        }),
                      }),
                      E.blockers.length > 0
                        ? t("div", {
                            className: "spec-hub-blockers",
                            children: E.blockers.map((s) =>
                              n(
                                "div",
                                {
                                  className: "spec-hub-blocker-item",
                                  children: [
                                    t(xe, { size: 14, "aria-hidden": !0 }),
                                    t("span", { children: V(s, e) }),
                                  ],
                                },
                                s
                              )
                            ),
                          })
                        : null,
                    ],
                  }),
                  t(Xt, {
                    value: "timeline",
                    className: "spec-hub-control-content min-h-0 flex-1 flex flex-col gap-2 p-2.5 overflow-auto",
                    children:
                      Oe.length === 0
                        ? n("div", {
                            className: "spec-hub-empty-state is-panel",
                            children: [
                              t(qt, { size: 18, "aria-hidden": !0 }),
                              t("p", {
                                className: "spec-hub-empty-state-title",
                                children: e("specHub.noTimeline"),
                              }),
                              t("p", {
                                className: "spec-hub-empty-state-desc",
                                children: e("specHub.noTimelineHint"),
                              }),
                            ],
                          })
                        : t("div", {
                            className: "spec-hub-timeline-list flex-1 min-h-0 flex flex-col gap-2 overflow-auto p-0",
                            children: Oe.map((s) =>
                              n(
                                "article",
                                {
                                  className: "spec-hub-timeline-item",
                                  children: [
                                    n("header", {
                                      children: [
                                        n("span", {
                                          className: `spec-hub-timeline-status ${
                                            s.success ? "ok" : "fail"
                                          }`,
                                          children: [
                                            s.success
                                              ? t(hi, { size: 14 })
                                              : t(J, { size: 14 }),
                                            t("strong", {
                                              children: e(
                                                `specHub.timelineKind.${s.kind}`
                                              ),
                                            }),
                                          ],
                                        }),
                                        t("time", {
                                          children: new Date(
                                            s.at
                                          ).toLocaleTimeString(),
                                        }),
                                      ],
                                    }),
                                    t("code", { children: s.command }),
                                    s.gitRefs.length > 0
                                      ? n("p", {
                                          className: "spec-hub-git-refs",
                                          children: [
                                            t(Hc, {
                                              size: 12,
                                              "aria-hidden": !0,
                                            }),
                                            t("span", {
                                              children: s.gitRefs.join(", "),
                                            }),
                                          ],
                                        })
                                      : null,
                                    t("pre", {
                                      children:
                                        s.output || e("specHub.emptyOutput"),
                                    }),
                                  ],
                                },
                                s.id
                              )
                            ),
                          }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      changeContextMenu && typeof document < "u"
        ? Ne(
            t("div", {
              className: "spec-hub-change-context-menu-layer fixed inset-0 z-[90] pointer-events-none",
              children: t("section", {
                ref: changeContextMenuRef,
                className: "spec-hub-change-context-menu fixed min-w-[220px] p-1.5 rounded-[10px] border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] [box-shadow:0_14px_32px_color-mix(in_srgb,var(--text-primary)_16%,transparent),0_2px_8px_color-mix(in_srgb,var(--text-primary)_10%,transparent)] pointer-events-auto",
                role: "menu",
                "aria-label": e("specHub.changeAction.menuLabel"),
                style: {
                  left: `${changeContextMenu.x}px`,
                  top: `${changeContextMenu.y}px`,
                },
                children: t("button", {
                  type: "button",
                  role: "menuitem",
                  className: "spec-hub-change-context-menu-item w-full flex items-center justify-start border-0 rounded-lg px-2.5 py-2 text-[12px] font-semibold text-left text-[color:var(--text-primary)] bg-transparent hover:bg-[color:var(--surface-item)] focus-visible:bg-[color:var(--surface-item)]",
                  onClick: () => {
                    changeContextMenu.isBacklogMember
                      ? removeChangeFromBacklog(changeContextMenu.changeId)
                      : addChangeToBacklog(changeContextMenu.changeId),
                      setChangeContextMenu(null);
                  },
                  children: changeContextMenu.isBacklogMember
                    ? e("specHub.changeAction.removeFromBacklog")
                    : e("specHub.changeAction.moveToBacklog"),
                }),
              }),
            }),
            document.body
          )
        : null,
      be && typeof document < "u"
        ? Ne(
            t("div", {
              className: "spec-hub-proposal-dialog-backdrop",
              role: "presentation",
              children: n("section", {
                className: "spec-hub-proposal-dialog",
                role: "dialog",
                "aria-label": e("specHub.proposal.dialogTitle"),
                children: [
                  n("header", {
                    className: "spec-hub-proposal-dialog-header",
                    children: [
                      n("div", {
                        className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                        children: [
                          t(Yt, { size: 14, "aria-hidden": !0 }),
                          t("span", {
                            children: e(
                              be === "create"
                                ? "specHub.proposal.dialogTitleCreate"
                                : "specHub.proposal.dialogTitleAppend"
                            ),
                          }),
                        ],
                      }),
                      t("button", {
                        type: "button",
                        className: "ghost",
                        onClick: () => {
                          Lt(null), ge(null), Ue([]);
                        },
                        "aria-label": e("specHub.proposal.closeDialog"),
                        title: e("specHub.proposal.closeDialog"),
                        children: t(ct, { size: 14, "aria-hidden": !0 }),
                      }),
                    ],
                  }),
                  n("div", {
                    className: "spec-hub-proposal-dialog-body",
                    children: [
                      t("p", {
                        className: "spec-hub-bootstrap-desc",
                        children: e(
                          be === "create"
                            ? "specHub.proposal.dialogDescriptionCreate"
                            : "specHub.proposal.dialogDescriptionAppend"
                        ),
                      }),
                      be === "append"
                        ? n("div", {
                            className: "spec-hub-auto-profile",
                            children: [
                              t("label", {
                                htmlFor: "spec-hub-proposal-target",
                                children: e(
                                  "specHub.proposal.targetChangeLabel"
                                ),
                              }),
                              t("select", {
                                id: "spec-hub-proposal-target",
                                value: an ?? "",
                                onChange: (s) => {
                                  Le(s.target.value || null);
                                },
                                children: le.map((s) =>
                                  t(
                                    "option",
                                    { value: s.id, children: s.id },
                                    `proposal-target-${s.id}`
                                  )
                                ),
                              }),
                              t("p", {
                                children: e(
                                  "specHub.proposal.targetChangeHint"
                                ),
                              }),
                            ],
                          })
                        : null,
                      n("div", {
                        className: "spec-hub-form-field",
                        children: [
                          n("div", {
                            className: "spec-hub-proposal-composer-header",
                            children: [
                              t("span", {
                                children: e("specHub.proposal.contentLabel"),
                              }),
                              n("button", {
                                type: "button",
                                className:
                                  "ghost spec-hub-proposal-attach-button",
                                onClick: () => {
                                  tc();
                                },
                                disabled: et,
                                "aria-label": e(
                                  "specHub.proposal.addImageAction"
                                ),
                                title: e("specHub.proposal.addImageAction"),
                                children: [
                                  t(Ec, { size: 14, "aria-hidden": !0 }),
                                  t("span", {
                                    children: e(
                                      "specHub.proposal.addImageAction"
                                    ),
                                  }),
                                ],
                              }),
                            ],
                          }),
                          t("div", {
                            ref: sc,
                            className: `spec-hub-proposal-composer${
                              nc ? " is-drag-over" : ""
                            }`,
                            onDragOver: ac,
                            onDragEnter: ic,
                            onDragLeave: oc,
                            onDrop: (s) => {
                              cc(s);
                            },
                            children: t("textarea", {
                              value: ha,
                              onChange: (s) => nn(s.target.value),
                              onPaste: (s) => {
                                rc(s);
                              },
                              placeholder: e(
                                be === "create"
                                  ? "specHub.proposal.contentPlaceholderCreate"
                                  : "specHub.proposal.contentPlaceholderAppend"
                              ),
                              rows: 9,
                            }),
                          }),
                          t("p", {
                            className: "spec-hub-proposal-attachment-hint",
                            children: e("specHub.proposal.attachmentHint", {
                              count: zn,
                            }),
                          }),
                          t(Ic, {
                            attachments: vt,
                            disabled: et,
                            onRemoveAttachment: ec,
                          }),
                        ],
                      }),
                      ba
                        ? n("p", {
                            className: "spec-hub-action-error",
                            children: [
                              t(J, { size: 14, "aria-hidden": !0 }),
                              t("span", { children: ba }),
                            ],
                          })
                        : null,
                    ],
                  }),
                  n("footer", {
                    className: "spec-hub-proposal-dialog-footer",
                    children: [
                      t("button", {
                        type: "button",
                        className: "ghost",
                        onClick: () => {
                          Lt(null), ge(null), Ue([]);
                        },
                        children: e("specHub.proposal.cancelAction"),
                      }),
                      n("button", {
                        type: "button",
                        className: "spec-hub-action-button",
                        onClick: () => {
                          lc();
                        },
                        children: [
                          t(Yt, { size: 16, "aria-hidden": !0 }),
                          t("span", {
                            children: e(
                              be === "create"
                                ? "specHub.proposal.submitCreateAction"
                                : "specHub.proposal.submitAppendAction"
                            ),
                          }),
                        ],
                      }),
                    ],
                  }),
                ],
              }),
            }),
            document.body
          )
        : null,
      Vt && typeof document < "u"
        ? Ne(
            t("div", {
              className: "spec-hub-feedback-link",
              "aria-hidden": !0,
              style: {
                left: `${Vt.left}px`,
                top: `${Vt.top}px`,
                width: `${Vt.width}px`,
                transform: `rotate(${Vt.angle}deg)`,
              },
              children: t("span", {
                children: e("specHub.autoCombo.linkLabel"),
              }),
            }),
            document.body
          )
        : null,
      Ut && typeof document < "u"
        ? Ne(
            t("div", {
              className: "spec-hub-feedback-link",
              "aria-hidden": !0,
              style: {
                left: `${Ut.left}px`,
                top: `${Ut.top}px`,
                width: `${Ut.width}px`,
                transform: `rotate(${Ut.angle}deg)`,
              },
              children: t("span", {
                children: e("specHub.autoCombo.linkLabel"),
              }),
            }),
            document.body
          )
        : null,
      Mo && typeof document < "u"
        ? Ne(
            n("section", {
              className: `spec-hub-apply-floating spec-hub-proposal-floating${
                _t ? " is-collapsed" : ""
              }${bs ? " is-dragging" : ""}`,
              style: { left: `${ee.x}px`, top: `${ee.y}px` },
              role: "dialog",
              "aria-label": e("specHub.proposal.title"),
              children: [
                n("header", {
                  className: "spec-hub-apply-floating-header",
                  onPointerDown: Es,
                  children: [
                    n("div", {
                      className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                      children: [
                        t(Yt, { size: 14, "aria-hidden": !0 }),
                        t("span", { children: e("specHub.proposal.title") }),
                      ],
                    }),
                    n("div", {
                      className: "spec-hub-apply-floating-actions",
                      children: [
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            hn((s) => !s);
                          },
                          "aria-label": e(
                            _t
                              ? "specHub.proposal.expandPanel"
                              : "specHub.proposal.collapsePanel"
                          ),
                          title: e(
                            _t
                              ? "specHub.proposal.expandPanel"
                              : "specHub.proposal.collapsePanel"
                          ),
                          children: _t
                            ? t(it, { size: 14, "aria-hidden": !0 })
                            : t(ot, { size: 14, "aria-hidden": !0 }),
                        }),
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            mn(!0), st();
                          },
                          "aria-label": e("specHub.proposal.closePanel"),
                          title: e("specHub.proposal.closePanel"),
                          children: t(ct, { size: 14, "aria-hidden": !0 }),
                        }),
                      ],
                    }),
                  ],
                }),
                _t
                  ? null
                  : n("div", {
                      className: "spec-hub-apply-floating-body",
                      children: [
                        n("div", {
                          className: "spec-hub-guidance-grid",
                          children: [
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.proposal.fieldStatus"),
                                }),
                                xt(w.status, Oo),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.proposal.fieldPhase"),
                                }),
                                t("strong", { children: zo }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.proposal.fieldEngine"),
                                }),
                                t("strong", {
                                  children: w.executor
                                    ? q(w.executor)
                                    : e("specHub.placeholder.notAvailable"),
                                }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.proposal.fieldMode"),
                                }),
                                t("strong", { children: Bo }),
                              ],
                            }),
                          ],
                        }),
                        w.startedAt
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.proposal.startedAt", {
                                  time: new Date(
                                    w.startedAt
                                  ).toLocaleTimeString(),
                                }),
                                w.finishedAt
                                  ? ` \xB7 ${e("specHub.proposal.finishedAt", {
                                      time: new Date(
                                        w.finishedAt
                                      ).toLocaleTimeString(),
                                    })}`
                                  : "",
                                ni
                                  ? ` \xB7 ${e("specHub.feedbackElapsed", {
                                      duration: ni,
                                    })}`
                                  : "",
                              ],
                            })
                          : null,
                        w.targetChangeId
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.proposal.fieldTarget"),
                                ": ",
                                w.targetChangeId,
                              ],
                            })
                          : null,
                        w.summary
                          ? t("p", {
                              className: "spec-hub-context-notice",
                              children: w.summary,
                            })
                          : null,
                        w.error
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", { children: w.error }),
                              ],
                            })
                          : null,
                        w.preflightBlockers.length > 0
                          ? n("div", {
                              className: "spec-hub-action-error",
                              children: [
                                t(xe, { size: 14, "aria-hidden": !0 }),
                                t("span", {
                                  children: e(
                                    "specHub.runtime.validationFixHint"
                                  ),
                                }),
                              ],
                            })
                          : null,
                        w.preflightBlockers.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", { children: "Preflight blockers" }),
                                t("code", {
                                  children: w.preflightBlockers.map(
                                    (s) => `- ${V(s, e)}`
                                  ).join(`
`),
                                }),
                              ],
                            })
                          : null,
                        w.preflightHints.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", { children: "Preflight hints" }),
                                t("code", {
                                  children: w.preflightHints.map(
                                    (s) => `- ${s}`
                                  ).join(`
`),
                                }),
                              ],
                            })
                          : null,
                        St(Cs),
                        wt([]),
                        w.streamOutput
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e("specHub.proposal.streamTitle"),
                                }),
                                t("code", {
                                  ref: Na,
                                  children: w.streamOutput,
                                }),
                              ],
                            })
                          : null,
                        w.logs.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e("specHub.proposal.logsTitle"),
                                }),
                                t("code", {
                                  ref: xa,
                                  children: w.logs.join(`
`),
                                }),
                              ],
                            })
                          : null,
                      ],
                    }),
              ],
            }),
            document.body
          )
        : null,
      ti && typeof document < "u"
        ? Ne(
            n("section", {
              className: `spec-hub-apply-floating spec-hub-continue-floating${
                Mt ? " is-collapsed" : ""
              }${bs ? " is-dragging" : ""}`,
              style: { left: `${ee.x}px`, top: `${ee.y}px` },
              role: "dialog",
              "aria-label": e("specHub.continueAiEnhancement.title"),
              children: [
                n("header", {
                  className: "spec-hub-apply-floating-header",
                  onPointerDown: Es,
                  children: [
                    n("div", {
                      className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                      children: [
                        t(Wt, { size: 14, "aria-hidden": !0 }),
                        t("span", {
                          children: e("specHub.continueAiEnhancement.title"),
                        }),
                      ],
                    }),
                    n("div", {
                      className: "spec-hub-apply-floating-actions",
                      children: [
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            ln((s) => !s);
                          },
                          "aria-label": e(
                            Mt
                              ? "specHub.continueAiEnhancement.expandPanel"
                              : "specHub.continueAiEnhancement.collapsePanel"
                          ),
                          title: e(
                            Mt
                              ? "specHub.continueAiEnhancement.expandPanel"
                              : "specHub.continueAiEnhancement.collapsePanel"
                          ),
                          children: Mt
                            ? t(it, { size: 14, "aria-hidden": !0 })
                            : t(ot, { size: 14, "aria-hidden": !0 }),
                        }),
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            rn(!0), st();
                          },
                          "aria-label": e(
                            "specHub.continueAiEnhancement.closePanel"
                          ),
                          title: e("specHub.continueAiEnhancement.closePanel"),
                          children: t(ct, { size: 14, "aria-hidden": !0 }),
                        }),
                      ],
                    }),
                  ],
                }),
                Mt
                  ? null
                  : n("div", {
                      className: "spec-hub-apply-floating-body",
                      children: [
                        n("div", {
                          className: "spec-hub-guidance-grid",
                          children: [
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.continueAiEnhancement.fieldStatus"
                                  ),
                                }),
                                xt(O.status, Fo),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.continueAiEnhancement.fieldPhase"
                                  ),
                                }),
                                t("strong", { children: Lo }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.continueAiEnhancement.fieldEngine"
                                  ),
                                }),
                                t("strong", {
                                  children: O.executor
                                    ? q(O.executor)
                                    : e("specHub.placeholder.notAvailable"),
                                }),
                              ],
                            }),
                          ],
                        }),
                        O.startedAt
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.continueAiEnhancement.startedAt", {
                                  time: new Date(
                                    O.startedAt
                                  ).toLocaleTimeString(),
                                }),
                                O.finishedAt
                                  ? ` \xB7 ${e(
                                      "specHub.continueAiEnhancement.finishedAt",
                                      {
                                        time: new Date(
                                          O.finishedAt
                                        ).toLocaleTimeString(),
                                      }
                                    )}`
                                  : "",
                                ii
                                  ? ` \xB7 ${e("specHub.feedbackElapsed", {
                                      duration: ii,
                                    })}`
                                  : "",
                              ],
                            })
                          : null,
                        O.summary
                          ? t("p", {
                              className: "spec-hub-context-notice",
                              children: O.summary,
                            })
                          : null,
                        O.error
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", { children: O.error }),
                              ],
                            })
                          : null,
                        St(Vo),
                        wt([]),
                        O.streamOutput
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.continueAiEnhancement.streamTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: Sa,
                                  children: O.streamOutput,
                                }),
                              ],
                            })
                          : null,
                        O.logs.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.continueAiEnhancement.logsTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: wa,
                                  children: O.logs.join(`
`),
                                }),
                              ],
                            })
                          : null,
                      ],
                    }),
              ],
            }),
            document.body
          )
        : null,
      Sn && typeof document < "u"
        ? Ne(
            n("section", {
              className: `spec-hub-apply-floating spec-hub-verify-floating${
                Bt ? " is-collapsed" : ""
              }${bs ? " is-dragging" : ""}`,
              style: { left: `${ee.x}px`, top: `${ee.y}px` },
              role: "dialog",
              "aria-label": e("specHub.verifyAutoComplete.title"),
              children: [
                n("header", {
                  className: "spec-hub-apply-floating-header",
                  onPointerDown: Es,
                  children: [
                    n("div", {
                      className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                      children: [
                        t(mi, { size: 14, "aria-hidden": !0 }),
                        t("span", {
                          children: e("specHub.verifyAutoComplete.title"),
                        }),
                      ],
                    }),
                    n("div", {
                      className: "spec-hub-apply-floating-actions",
                      children: [
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            Ha((s) => !s);
                          },
                          "aria-label": e(
                            Bt
                              ? "specHub.verifyAutoComplete.expandPanel"
                              : "specHub.verifyAutoComplete.collapsePanel"
                          ),
                          title: e(
                            Bt
                              ? "specHub.verifyAutoComplete.expandPanel"
                              : "specHub.verifyAutoComplete.collapsePanel"
                          ),
                          children: Bt
                            ? t(it, { size: 14, "aria-hidden": !0 })
                            : t(ot, { size: 14, "aria-hidden": !0 }),
                        }),
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            Aa(!0), st();
                          },
                          "aria-label": e(
                            "specHub.verifyAutoComplete.closePanel"
                          ),
                          title: e("specHub.verifyAutoComplete.closePanel"),
                          children: t(ct, { size: 14, "aria-hidden": !0 }),
                        }),
                      ],
                    }),
                  ],
                }),
                Bt
                  ? null
                  : n("div", {
                      className: "spec-hub-apply-floating-body",
                      children: [
                        n("div", {
                          className: "spec-hub-guidance-grid",
                          children: [
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.verifyAutoComplete.fieldStatus"
                                  ),
                                }),
                                xt(D.status, _o),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.verifyAutoComplete.fieldPhase"
                                  ),
                                }),
                                t("strong", { children: Go }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.verifyAutoComplete.fieldEngine"
                                  ),
                                }),
                                t("strong", {
                                  children: D.executor
                                    ? q(D.executor)
                                    : e("specHub.placeholder.notAvailable"),
                                }),
                              ],
                            }),
                          ],
                        }),
                        D.startedAt
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.verifyAutoComplete.startedAt", {
                                  time: new Date(
                                    D.startedAt
                                  ).toLocaleTimeString(),
                                }),
                                D.finishedAt
                                  ? ` \xB7 ${e(
                                      "specHub.verifyAutoComplete.finishedAt",
                                      {
                                        time: new Date(
                                          D.finishedAt
                                        ).toLocaleTimeString(),
                                      }
                                    )}`
                                  : "",
                                ai
                                  ? ` \xB7 ${e("specHub.feedbackElapsed", {
                                      duration: ai,
                                    })}`
                                  : "",
                              ],
                            })
                          : null,
                        D.summary
                          ? t("p", {
                              className: "spec-hub-context-notice",
                              children: D.summary,
                            })
                          : null,
                        D.validateSkipped
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", {
                                  children: e(
                                    "specHub.verifyAutoComplete.validateSkipped"
                                  ),
                                }),
                              ],
                            })
                          : null,
                        D.error
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", { children: D.error }),
                              ],
                            })
                          : null,
                        St(Cs),
                        wt([]),
                        D.streamOutput
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.verifyAutoComplete.streamTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: Ea,
                                  children: D.streamOutput,
                                }),
                              ],
                            })
                          : null,
                        D.logs.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.verifyAutoComplete.logsTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: Pa,
                                  children: D.logs.join(`
`),
                                }),
                              ],
                            })
                          : null,
                      ],
                    }),
              ],
            }),
            document.body
          )
        : null,
      Yo && typeof document < "u"
        ? Ne(
            n("section", {
              className: `spec-hub-apply-floating spec-hub-ai-takeover-floating${
                Rt ? " is-collapsed" : ""
              }${bs ? " is-dragging" : ""}`,
              style: { left: `${ee.x}px`, top: `${ee.y}px` },
              role: "dialog",
              "aria-label": e("specHub.aiTakeover.title"),
              children: [
                n("header", {
                  className: "spec-hub-apply-floating-header",
                  onPointerDown: Es,
                  children: [
                    n("div", {
                      className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                      children: [
                        t(Se, { size: 14, "aria-hidden": !0 }),
                        t("span", { children: e("specHub.aiTakeover.title") }),
                      ],
                    }),
                    n("div", {
                      className: "spec-hub-apply-floating-actions",
                      children: [
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            Zs((s) => !s);
                          },
                          "aria-label": e(
                            Rt
                              ? "specHub.aiTakeover.expandPanel"
                              : "specHub.aiTakeover.collapsePanel"
                          ),
                          title: e(
                            Rt
                              ? "specHub.aiTakeover.expandPanel"
                              : "specHub.aiTakeover.collapsePanel"
                          ),
                          children: Rt
                            ? t(it, { size: 14, "aria-hidden": !0 })
                            : t(ot, { size: 14, "aria-hidden": !0 }),
                        }),
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            Js(!0), st();
                          },
                          "aria-label": e("specHub.aiTakeover.closePanel"),
                          title: e("specHub.aiTakeover.closePanel"),
                          children: t(ct, { size: 14, "aria-hidden": !0 }),
                        }),
                      ],
                    }),
                  ],
                }),
                Rt
                  ? null
                  : n("div", {
                      className: "spec-hub-apply-floating-body",
                      children: [
                        n("div", {
                          className: "spec-hub-guidance-grid",
                          children: [
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.aiTakeover.statusLabel"),
                                }),
                                xt(ft, e(`specHub.aiTakeover.status.${ft}`)),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.aiTakeover.phase.agent"),
                                }),
                                t("strong", {
                                  children: e(`specHub.aiTakeover.phase.${ia}`),
                                }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.aiTakeover.agentLabel"),
                                }),
                                t("strong", { children: q(S) }),
                              ],
                            }),
                          ],
                        }),
                        Te
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.aiTakeover.startedAt", {
                                  time: new Date(Te).toLocaleTimeString(),
                                }),
                                $t
                                  ? ` \xB7 ${e(
                                      "specHub.aiTakeover.finishedAt",
                                      {
                                        time: new Date($t).toLocaleTimeString(),
                                      }
                                    )}`
                                  : "",
                                ei
                                  ? ` \xB7 ${e("specHub.aiTakeover.elapsed", {
                                      duration: ei,
                                    })}`
                                  : "",
                              ],
                            })
                          : null,
                        Ys !== "idle"
                          ? t("p", {
                              className: `spec-hub-ai-takeover-refresh is-${Ys}`,
                              children: e(
                                `specHub.aiTakeover.refreshState.${Ys}`
                              ),
                            })
                          : null,
                        t("div", {
                          className: "spec-hub-ai-takeover-phases",
                          children: Mn.map((s) => {
                            const o = Zo(s);
                            return n(
                              "p",
                              {
                                className: `is-${o}`,
                                children: [
                                  t("span", {
                                    children: e(
                                      `specHub.aiTakeover.phase.${s}`
                                    ),
                                  }),
                                  t("strong", {
                                    children: e(
                                      `specHub.aiTakeover.phaseState.${o}`
                                    ),
                                  }),
                                ],
                              },
                              `ai-floating-phase-${s}`
                            );
                          }),
                        }),
                        Bs
                          ? t("p", {
                              className: "spec-hub-context-notice",
                              children: Bs,
                            })
                          : null,
                        _s
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", { children: _s }),
                              ],
                            })
                          : null,
                        St(Cs),
                        wt([]),
                        He || ss
                          ? n("div", {
                              className:
                                "spec-hub-command-preview spec-hub-ai-takeover-stream",
                              children: [
                                t("span", {
                                  children: e("specHub.aiTakeover.streamTitle"),
                                }),
                                t("code", {
                                  ref: Fa,
                                  children:
                                    ss || e("specHub.aiTakeover.streamEmpty"),
                                }),
                              ],
                            })
                          : null,
                        Gs
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e("specHub.aiTakeover.outputTitle"),
                                }),
                                t("code", { children: Gs }),
                              ],
                            })
                          : null,
                        n("div", {
                          className:
                            "spec-hub-command-preview spec-hub-ai-takeover-logs",
                          children: [
                            t("span", {
                              children: e("specHub.aiTakeover.logsTitle"),
                            }),
                            t("code", {
                              ref: La,
                              children: Wo || e("specHub.aiTakeover.noLogs"),
                            }),
                          ],
                        }),
                      ],
                    }),
              ],
            }),
            document.body
          )
        : null,
      Hs && typeof document < "u"
        ? Ne(
            n("section", {
              className: `spec-hub-apply-floating${Ft ? " is-collapsed" : ""}${
                Vi ? " is-dragging" : ""
              }`,
              style: { left: `${he.x}px`, top: `${he.y}px` },
              role: "dialog",
              "aria-label": e("specHub.applyExecution.title"),
              children: [
                n("header", {
                  className: "spec-hub-apply-floating-header",
                  onPointerDown: Ko,
                  children: [
                    n("div", {
                      className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                      children: [
                        t(Rn, { size: 14, "aria-hidden": !0 }),
                        t("span", {
                          children: e("specHub.applyExecution.title"),
                        }),
                      ],
                    }),
                    n("div", {
                      className: "spec-hub-apply-floating-actions",
                      children: [
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            cs((s) => !s);
                          },
                          "aria-label": e(
                            Ft
                              ? "specHub.applyExecution.expandPanel"
                              : "specHub.applyExecution.collapsePanel"
                          ),
                          title: e(
                            Ft
                              ? "specHub.applyExecution.expandPanel"
                              : "specHub.applyExecution.collapsePanel"
                          ),
                          children: Ft
                            ? t(it, { size: 14, "aria-hidden": !0 })
                            : t(ot, { size: 14, "aria-hidden": !0 }),
                        }),
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            os(!0);
                          },
                          "aria-label": e("specHub.applyExecution.closePanel"),
                          title: e("specHub.applyExecution.closePanel"),
                          children: t(ct, { size: 14, "aria-hidden": !0 }),
                        }),
                      ],
                    }),
                  ],
                }),
                Ft
                  ? null
                  : n("div", {
                      className: "spec-hub-apply-floating-body",
                      children: [
                        n("div", {
                          className: "spec-hub-guidance-grid",
                          children: [
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.fieldStatus"
                                  ),
                                }),
                                xt(v.status, $o),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.fieldPhase"
                                  ),
                                }),
                                t("strong", { children: Ro }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.fieldExecutor"
                                  ),
                                }),
                                t("strong", {
                                  children: v.executor
                                    ? q(v.executor)
                                    : e("specHub.placeholder.notAvailable"),
                                }),
                              ],
                            }),
                          ],
                        }),
                        v.startedAt
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.applyExecution.startedAt", {
                                  time: new Date(
                                    v.startedAt
                                  ).toLocaleTimeString(),
                                }),
                                v.finishedAt
                                  ? ` \xB7 ${e(
                                      "specHub.applyExecution.finishedAt",
                                      {
                                        time: new Date(
                                          v.finishedAt
                                        ).toLocaleTimeString(),
                                      }
                                    )}`
                                  : "",
                                si
                                  ? ` \xB7 ${e("specHub.feedbackElapsed", {
                                      duration: si,
                                    })}`
                                  : "",
                              ],
                            })
                          : null,
                        v.summary
                          ? t("p", {
                              className: "spec-hub-context-notice",
                              children: V(v.summary, e),
                            })
                          : null,
                        v.status === "success" && v.noChanges
                          ? t("p", {
                              className: "spec-hub-running",
                              children: e("specHub.applyExecution.noChanges"),
                            })
                          : null,
                        v.error
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", { children: V(v.error, e) }),
                              ],
                            })
                          : null,
                        St(jo),
                        wt(v.changedFiles),
                        v.tests.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.testsTitle"
                                  ),
                                }),
                                t("code", {
                                  children: v.tests.join(`
`),
                                }),
                              ],
                            })
                          : null,
                        v.checks.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.checksTitle"
                                  ),
                                }),
                                t("code", {
                                  children: v.checks.join(`
`),
                                }),
                              ],
                            })
                          : null,
                        v.executionOutput
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.streamTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: $a,
                                  children: v.executionOutput,
                                }),
                              ],
                            })
                          : null,
                        v.logs.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.logsTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: Ra,
                                  children: v.logs.map((s) => cr(s, e)).join(`
`),
                                }),
                              ],
                            })
                          : null,
                      ],
                    }),
              ],
            }),
            document.body
          )
        : null,
      xn && typeof document < "u"
        ? Ne(
            n("section", {
              className: `spec-hub-apply-floating spec-hub-auto-combo-floating${
                Ot ? " is-collapsed" : ""
              }${Ki ? " is-dragging" : ""}`,
              style: { left: `${Ie.x}px`, top: `${Ie.y}px` },
              role: "dialog",
              "aria-label": e("specHub.autoCombo.title"),
              children: [
                n("header", {
                  className: "spec-hub-apply-floating-header",
                  onPointerDown: Jo,
                  children: [
                    n("div", {
                      className: "spec-hub-panel-title inline-flex items-center gap-1.5 text-[12px] font-bold text-[color:var(--text-secondary)] tracking-[0.02em] uppercase",
                      children: [
                        t(Wt, { size: 14, "aria-hidden": !0 }),
                        t("span", { children: e("specHub.autoCombo.title") }),
                      ],
                    }),
                    n("div", {
                      className: "spec-hub-apply-floating-actions",
                      children: [
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            dn((s) => !s);
                          },
                          "aria-label": e(
                            Ot
                              ? "specHub.autoCombo.expandPanel"
                              : "specHub.autoCombo.collapsePanel"
                          ),
                          title: e(
                            Ot
                              ? "specHub.autoCombo.expandPanel"
                              : "specHub.autoCombo.collapsePanel"
                          ),
                          children: Ot
                            ? t(it, { size: 14, "aria-hidden": !0 })
                            : t(ot, { size: 14, "aria-hidden": !0 }),
                        }),
                        t("button", {
                          type: "button",
                          className: "ghost",
                          onClick: () => {
                            pn(!0), ms(!1), We.current?.(), (We.current = null);
                          },
                          "aria-label": e("specHub.autoCombo.closePanel"),
                          title: e("specHub.autoCombo.closePanel"),
                          children: t(ct, { size: 14, "aria-hidden": !0 }),
                        }),
                      ],
                    }),
                  ],
                }),
                Ot
                  ? null
                  : n("div", {
                      className: "spec-hub-apply-floating-body",
                      children: [
                        n("div", {
                          className: "spec-hub-guidance-grid",
                          children: [
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.autoCombo.fieldStatus"),
                                }),
                                xt(H.status, Io),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.autoCombo.fieldPhase"),
                                }),
                                t("strong", { children: Do }),
                              ],
                            }),
                            n("article", {
                              className: "spec-hub-guidance-field",
                              children: [
                                t("span", {
                                  children: e("specHub.autoCombo.fieldEngine"),
                                }),
                                t("strong", {
                                  children: H.executor
                                    ? q(H.executor)
                                    : e("specHub.placeholder.notAvailable"),
                                }),
                              ],
                            }),
                          ],
                        }),
                        H.startedAt
                          ? n("p", {
                              className: "spec-hub-bootstrap-desc",
                              children: [
                                e("specHub.autoCombo.startedAt", {
                                  time: new Date(
                                    H.startedAt
                                  ).toLocaleTimeString(),
                                }),
                                H.finishedAt
                                  ? ` \xB7 ${e("specHub.autoCombo.finishedAt", {
                                      time: new Date(
                                        H.finishedAt
                                      ).toLocaleTimeString(),
                                    })}`
                                  : "",
                                oi
                                  ? ` \xB7 ${e("specHub.feedbackElapsed", {
                                      duration: oi,
                                    })}`
                                  : "",
                              ],
                            })
                          : null,
                        H.summary
                          ? t("p", {
                              className: "spec-hub-context-notice",
                              children: H.summary,
                            })
                          : null,
                        H.error
                          ? n("p", {
                              className: "spec-hub-action-error",
                              children: [
                                t(J, { size: 14, "aria-hidden": !0 }),
                                t("span", { children: H.error }),
                              ],
                            })
                          : null,
                        St(Uo),
                        wt(H.changedFiles),
                        H.streamOutput
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e(
                                    "specHub.applyExecution.streamTitle"
                                  ),
                                }),
                                t("code", {
                                  ref: Ia,
                                  children: H.streamOutput,
                                }),
                              ],
                            })
                          : null,
                        H.logs.length > 0
                          ? n("div", {
                              className: "spec-hub-command-preview",
                              children: [
                                t("span", {
                                  children: e("specHub.autoCombo.logsTitle"),
                                }),
                                t("code", {
                                  ref: Da,
                                  children: H.logs.join(`
`),
                                }),
                              ],
                            })
                          : null,
                      ],
                    }),
              ],
            }),
            document.body
          )
        : null,
    ],
  });
}
export { xl as SpecHubPresentational };
