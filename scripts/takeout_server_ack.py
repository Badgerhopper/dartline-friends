#!/usr/bin/env python3
"""DartLine v4.4: authoritative, idempotent verified-takeout status.

The previous "auto-submit ON" was client-side optimism. The camera could send
two empty frames to a server where verified takeout was disabled, or repeat
enable messages could reset the server midway through the two-frame vote.
Make the server setting idempotent, return an acknowledged status, and resync
the setting on WebSocket reconnect/periodically without clearing votes.
This does NOT weaken recognition or change server ownership of match state.
"""
from pathlib import Path
import sys

def patch(p:Path, before:str, after:str):
    text=p.read_text(encoding="utf-8")
    hits=text.count(before)
    if hits!=1:
        raise RuntimeError(f"v4.4 integration anchor mismatch {p}: {before[:85]!r}, {hits} matches")
    p.write_text(text.replace(before,after,1),encoding="utf-8")

def install(root:Path):
    protocol=root/"src/shared/protocol.ts"
    patch(protocol,
      "export interface CorrectDartMessage {",
      """export interface VerifiedTakeoutStatusMessage {
  type:'verified_takeout_status';
  matchId:string;
  enabled:boolean;
  cameraCount:number;
  confirmations:number;
  lastReason:string;
}
export interface CorrectDartMessage {""")
    patch(protocol,
      "  | MatchStateMessage\\n  | ModeCatalogMessage",
      "  | MatchStateMessage\\n  | VerifiedTakeoutStatusMessage\\n  | ModeCatalogMessage")

    session=root/"src/server/scoring/session.ts"
    patch(session,
      """  private takeoutMode:'legacy'|'off'|'verified'='legacy';
  private readonly verifiedClear=new VerifiedBoardClear();

  setVerifiedTakeout(enabled:boolean):void {
    this.takeoutMode=enabled?'verified':'off';
    this.verifiedClear.reset();
    this.consecutiveEmpty=0;
    this.emptyCameras.clear();
  }""",
      """  private takeoutMode:'legacy'|'off'|'verified'='legacy';
  private readonly verifiedClear=new VerifiedBoardClear();
  private takeoutReason='No verified removal frames yet';

  // Reconnects and the HUD periodically reassert this setting. An identical
  // reassertion must NOT discard the first of two real empty confirmations.
  setVerifiedTakeout(enabled:boolean):void {
    const desired=enabled?'verified':'off';
    if(this.takeoutMode===desired) return;
    this.takeoutMode=desired;
    this.verifiedClear.reset();
    this.consecutiveEmpty=0;
    this.emptyCameras.clear();
    this.takeoutReason=enabled?'Waiting for verified empty board':'Disabled';
  }
  get verifiedTakeoutStatus() {
    return {
      enabled:this.takeoutMode==='verified',
      cameraCount:this.cameras.size,
      confirmations:this.verifiedClear.confirmations,
      lastReason:this.takeoutReason,
    };
  }""")
    patch(session,
      """        const freshUnanimous=result.reports.length>=this.cameras.size
          && result.reports.every(report=>report.tips.length===0);
        const match=this.playableMatch();
        const eligible=Boolean(match && this.scoringPlayerId(match));
        if (this.verifiedClear.observe(freshUnanimous && eligible,
          match?.currentVisit?.darts.length ?? 0,Date.now()) && match) {""",
      """        const freshUnanimous=result.reports.length>=this.cameras.size
          && result.reports.every(report=>report.tips.length===0);
        const match=this.playableMatch();
        const eligible=Boolean(match && this.scoringPlayerId(match));
        const dartCount=match?.currentVisit?.darts.length ?? 0;
        this.takeoutReason=!freshUnanimous
          ? 'Waiting for all assigned cameras to report empty'
          : !eligible ? 'No assigned active player'
          : dartCount!==3 ? 'Waiting for three recorded darts'
          : 'Confirming empty board';
        if (this.verifiedClear.observe(freshUnanimous && eligible,
          dartCount,Date.now()) && match) {
          this.takeoutReason='Board confirmed empty, submitting visit';""")
    patch(session,
      """    this.verifiedClear.reset();
    this.consecutiveEmpty = 0;""",
      """    this.verifiedClear.reset();
    this.takeoutReason='Darts remain visible';
    this.consecutiveEmpty = 0;""")

    verified=root/"src/server/scoring/verifiedBoardClear.ts"
    patch(verified,
      "  private confirmed = 0;\\n",
      "  private confirmed = 0;\\n  get confirmations():number {return this.confirmed;}\\n")

    ws=root/"src/server/wsHandler.ts"
    patch(ws,
      """  getScoringSession(match.id,mine,commitScoredMatch).setVerifiedTakeout(msg.enabled);
}""",
      """  const session=getScoringSession(match.id,mine,commitScoredMatch);
  session.setVerifiedTakeout(msg.enabled);
  // Real server acknowledgment, not just a green local-storage toggle.
  send(ws,{type:'verified_takeout_status',matchId:match.id,
    ...session.verifiedTakeoutStatus});
}""")

    hook=root/"src/client/hooks/useMatch.ts"
    patch(hook,
      """    switch (msg.type) {
      // What to present if this tab is loaded again.""",
      """    switch (msg.type) {
      case 'verified_takeout_status':
        window.dispatchEvent(new CustomEvent('dartline:verified-takeout-status', {
          detail:msg,
        }));
        break;
      // What to present if this tab is loaded again.""")
    # The server setting isn't guaranteed after a render service restart or
    # WebSocket reconnect. Reasserting it is safe after the idempotent fix.
    hud=root/"src/client/components/MobileMatchHUD.tsx"
    patch(hud,
      """  const [sector, setSector] = useState('20');""",
      """  const [takeoutServer, setTakeoutServer] = useState<{
    matchId:string;enabled:boolean;cameraCount:number;
    confirmations:number;lastReason:string;
  } | null>(null);
  useEffect(() => {
    const receive=(event:Event) => {
      const v=(event as CustomEvent<any>).detail;
      if(!v || v.matchId!==match.id || typeof v.enabled!=='boolean' ||
         typeof v.cameraCount!=='number' ||
         typeof v.confirmations!=='number' ||
         typeof v.lastReason!=='string') return;
      setTakeoutServer(v);
    };
    window.addEventListener('dartline:verified-takeout-status',receive);
    return () => window.removeEventListener('dartline:verified-takeout-status',receive);
  },[match.id]);
  useEffect(() => {setTakeoutServer(null);},[match.id,autoTakeout]);
  const [sector, setSector] = useState('20');""")
    patch(hud,
      """  }, [match.id, match.status, onAutoTakeoutChange, autoTakeout]);
  const changeAutoTakeout = () => {""",
      """  }, [match.id, match.status, onAutoTakeoutChange, autoTakeout]);
  // A connection may reset between visits. The server treats an unchanged
  // enabled setting as idempotent, so a periodic resync cannot reset its
  // two-frame empty-board confirmation state.
  useEffect(() => {
    if(match.status!=='in_progress' || !autoTakeout) return;
    const timer=window.setInterval(() => onAutoTakeoutChange(true),5000);
    return () => window.clearInterval(timer);
  },[match.id,match.status,onAutoTakeoutChange,autoTakeout]);
  const changeAutoTakeout = () => {""")
    patch(hud,
      """      {autoTakeout && <p className="dartline-hud-takeout-note">After all 3 darts are scored, removing them submits
        the turn only after removal motion and two clear scans. Check scores before retrieving.</p>}""",
      """      {autoTakeout && <p className="dartline-hud-takeout-note">
        {takeoutServer?.enabled
          ? (takeoutServer.cameraCount===0
              ? 'Auto-submit enabled on server, but no scoring camera is assigned'
              : takeoutServer.confirmations===1
                ? 'Auto-submit: server has confirmed 1 of 2 empty scans'
                : 'Auto-submit: server ready · '+takeoutServer.lastReason)
          : 'Auto-submit: waiting for server confirmation'}
        {' · '}Requires three recorded darts and verified removal.
      </p>}""")

    (root/"src/client/public/dartline-build.txt").write_text(
      "dartline-v4.4-takeout-ack-and-diagnostics-2026-11-26\n",encoding="utf-8")
    print("DartLine v4.4: server-acknowledged, reconnect-safe auto-submit installed")

if __name__=="__main__":
    try:install(Path(sys.argv[1]).resolve())
    except Exception as err:
        print("DartLine v4.4 patch failed:",err,file=sys.stderr)
        sys.exit(1)
