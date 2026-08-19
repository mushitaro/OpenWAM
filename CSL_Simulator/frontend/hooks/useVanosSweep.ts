"use client";

/**
 * Drives the live VANOS sweep: keep-alive, cam ramps, arrival, and the command
 * state every recorded sample is stamped with.
 *
 * Safety shape, in one place so it is auditable:
 *  - The keep-alive is what holds the override. STOPPING IT IS THE ABORT — the
 *    DME reverts to its own map on the next background cycle. Every teardown
 *    path (abort, disconnect, unmount, tab change) therefore stops the timer,
 *    and none of them depend on a command being delivered to release the cams.
 *  - Commands are ramped, never stepped: |soll − ist| over 10 degKW raises a
 *    VANOS DTC, and the override bypasses the DME's own rate limiter.
 *  - A refusal from the DME is a value, not an exception, and it stops the
 *    ramp — re-sending a semantic refusal cannot fix it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DmeTelemetryLink, LiveSample, supportsVanosControl } from "../lib/dme-link/types";
import { VanosPin } from "../lib/dme-link/ds2";
import { SWEEP_DEFAULTS } from "../lib/sweep/options";
import { clampToStorable, hasArrived, isStorable, planRamp, SweepAxis } from "../lib/sweep/controller";

export type SweepPhase =
    | "off"          // no sweep running; cams under DME map control
    | "holding"      // an angle is commanded and the cam has arrived
    | "ramping"      // stepping toward a new angle
    | "waiting"      // last step sent, waiting for the cam to catch up
    | "error";       // a command was refused or the link failed

export interface SweepCommandState {
    axis: SweepAxis;
    /** null = no override (baseline / anchor). */
    intake: number | null;
    exhaust: number | null;
}

export interface UseVanosSweep {
    phase: SweepPhase;
    /** What is commanded right now — stamped onto every recorded sample. */
    commandRef: React.MutableRefObject<SweepCommandState>;
    axis: SweepAxis;
    setAxis: (a: SweepAxis) => void;
    /** Human-readable status for the panel. Always says what to do next. */
    message: string | null;
    /** True while the DME session is being held open. */
    keepAliveOn: boolean;
    supported: boolean;
    /** Command an angle (null releases the override back to map control). */
    goTo: (angle: number | null) => Promise<void>;
    /** Immediate, unconditional stand-down. */
    abort: () => Promise<void>;
    busy: boolean;
}

const NOT_SUPPORTED = "この接続では VANOS 指令が使えません（モックか実車リンクを接続してください）。";

export function useVanosSweep(
    linkRef: React.MutableRefObject<DmeTelemetryLink | null>,
    connected: boolean,
    latestRef: React.MutableRefObject<LiveSample | null>,
    /** The recorder's command ref. Passing it in (rather than owning one here)
     *  guarantees the angle a sample is stamped with is the angle that was
     *  actually commanded — two refs would drift by one command. */
    externalCmdRef?: React.MutableRefObject<{ intake: number | null; exhaust: number | null; transient?: boolean }>,
): UseVanosSweep {
    const [phase, setPhase] = useState<SweepPhase>("off");
    const [axis, setAxis] = useState<SweepAxis>("intake");
    const [message, setMessage] = useState<string | null>(null);
    const [keepAliveOn, setKeepAliveOn] = useState(false);
    const [busy, setBusy] = useState(false);

    const ownCmdRef = useRef<SweepCommandState>({ axis: "intake", intake: null, exhaust: null });
    const commandRef = ownCmdRef;
    /** Mirror every command into the recorder's ref in the same tick. */
    const publish = useCallback((transient = false) => {
        if (externalCmdRef) {
            externalCmdRef.current.intake = commandRef.current.intake;
            externalCmdRef.current.exhaust = commandRef.current.exhaust;
            externalCmdRef.current.transient = transient;
        }
    }, [externalCmdRef, commandRef]);
    const keepAliveTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const abortedRef = useRef(false);

    useEffect(() => { commandRef.current.axis = axis; }, [axis]);

    const stopKeepAlive = useCallback(() => {
        if (keepAliveTimer.current) {
            clearInterval(keepAliveTimer.current);
            keepAliveTimer.current = null;
        }
        setKeepAliveOn(false);
    }, []);

    const startKeepAlive = useCallback(() => {
        if (keepAliveTimer.current) return;
        keepAliveTimer.current = setInterval(() => {
            const link = linkRef.current;
            // Best effort by contract: never awaited, never throws, and nothing
            // branches on the result. It is a heartbeat, not a health check.
            if (link && supportsVanosControl(link)) void link.keepAlive();
        }, SWEEP_DEFAULTS.keepAliveMs);
        setKeepAliveOn(true);
    }, [linkRef]);

    /** The one stand-down path. Safe to call repeatedly and from teardown. */
    const abort = useCallback(async () => {
        abortedRef.current = true;
        stopKeepAlive();                       // <- this is what releases the cams
        commandRef.current.intake = null;
        commandRef.current.exhaust = null;
        publish();
        setPhase("off");
        setBusy(false);
        setMessage("VANOS 指令を解除しました。DME のマップ制御に戻ります。");
    }, [stopKeepAlive, publish, commandRef]);

    // Losing the link must never leave the UI claiming cams are held.
    useEffect(() => {
        if (!connected && (keepAliveTimer.current || phase !== "off")) void abort();
    }, [connected, phase, abort]);

    // Unmount (including a tab switch that unmounts the panel) stands down too.
    useEffect(() => () => { stopKeepAlive(); }, [stopKeepAlive]);

    const goTo = useCallback(async (angle: number | null) => {
        const link = linkRef.current;
        if (!link || !supportsVanosControl(link)) { setMessage(NOT_SUPPORTED); setPhase("error"); return; }
        if (busy) return;
        abortedRef.current = false;
        setBusy(true);

        try {
            const pin = axis === "intake" ? VanosPin.INTAKE : VanosPin.EXHAUST;
            const key = axis === "intake" ? "intake" : "exhaust";

            if (angle === null) {
                // Release: stop holding the session open and let the DME take
                // its map back. There is no "release" command — absence is the
                // release, which is why the abort path cannot fail.
                stopKeepAlive();
                commandRef.current[key] = null;
                publish();
                setPhase("off");
                setMessage("指令を解除しました（基準走行）。この状態でプルすると基準データになります。");
                return;
            }

            if (!isStorable(axis, angle)) {
                setPhase("error");
                setMessage(`${angle}° は書き戻せる範囲の外です。`
                    + `${axis === "intake" ? "吸気は 0〜60°" : "排気は 0〜45°"} の中で指令してください。`);
                return;
            }

            startKeepAlive();   // hold the session BEFORE commanding anything
            const target = clampToStorable(axis, angle);
            const current = axis === "intake"
                ? (latestRef.current?.evanIst ?? 0)
                : (latestRef.current?.avanIst ?? 0);

            setPhase("ramping");
            const steps = planRamp(current, target);
            setMessage(`${target}° へ ${steps.length} 段でランプ中…`);
            for (const s of steps) {
                if (abortedRef.current) return;
                const ack = await link.setVanosTarget(pin, s);
                if (!ack.accepted) {
                    // Semantic refusal: stop. Retrying cannot change the answer.
                    setPhase("error");
                    setMessage(ack.message);
                    stopKeepAlive();
                    commandRef.current[key] = null;
                    publish();
                    return;
                }
                commandRef.current[key] = s;
                publish(true);   // mid-ramp: not a setting anyone chose
                await new Promise(r => setTimeout(r, SWEEP_DEFAULTS.rampIntervalMs));
            }

            setPhase("waiting");
            publish(true);
            setMessage(`${target}° への到達を待っています…`);
            const deadline = Date.now() + SWEEP_DEFAULTS.arrivalTimeoutMs;
            while (Date.now() < deadline) {
                if (abortedRef.current) return;
                const s = latestRef.current;
                if (s && hasArrived(axis, s)) {
                    commandRef.current[key] = target;
                    publish(false);   // arrived: this IS the setting
                    setPhase("holding");
                    setMessage(`${target}° に到達。全開プルを開始してください。`);
                    return;
                }
                await new Promise(r => setTimeout(r, 120));
            }
            setPhase("error");
            setMessage(`${target}° に到達しませんでした。油温が低い、あるいは指令が届いていない可能性があります。`
                + "この設定のデータは使われません。");
        } catch (e) {
            setPhase("error");
            setMessage(`指令に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            setBusy(false);
        }
    }, [axis, busy, linkRef, latestRef, startKeepAlive, stopKeepAlive, publish, commandRef]);

    const link = linkRef.current;
    return {
        phase, commandRef, axis, setAxis, message, keepAliveOn, busy,
        supported: !!link && supportsVanosControl(link),
        goTo, abort,
    };
}
