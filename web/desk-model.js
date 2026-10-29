// Presentation-only contracts. These labels never change the engine or select trades.
(function (root) {
  'use strict';
  const strategies = [
    ['D_BEARTRAP','Daily bear trap','Daily close','Daily engulfing and reclaim inside an uptrend; long-only setup.'],
    ['D_THRUST','Daily thrust pullback','Hourly close','A large daily thrust followed by a qualifying hourly pullback.'],
    ['HTF_TREND','4H trend breakout','4H close','A closed-bar breakout of the configured higher-timeframe range.'],
    ['TREND_MTF','MTF SuperTrend','5-minute close','SuperTrend flip with the configured higher-timeframe alignment and filters.'],
    ['SESSION_BO','Session breakout','15-minute close','Session-range breakout subject to configured volume, time and trend rules.'],
    ['VWAP_REVERT','VWAP snap-back','15-minute close','A ranging-market deviation and reversal around the daily VWAP.'],
    ['SWEEP_REV','Liquidity sweep reversal','15-minute close','A qualifying wick beyond a prior extreme followed by rejection.'],
    ['HTF_SWEEP','Higher-timeframe sweep','Configured HTF','Opt-in rejection at a higher-timeframe extreme.'],
    ['EMA_CROSS','EMA crossover','Configured timeframe','Opt-in EMA20/50 crossover with configured trend and stop rules.'],
    ['SSR','Session sweep reversal','15-minute close','Opt-in session sweep and reclaim with structure conditions.'],
    ['EMA_PB','EMA pullback','15-minute close','Opt-in intraday pullback and continuation setup.'],
  ].map(([id,name,cadence,desc]) => ({id,name,cadence,desc,ev:'Historical and current evidence must match this instrument, code and configuration. No profitability certification is implied.'}));
  const families = {D_BEARTRAP:'Reversal',D_THRUST:'Trend',HTF_TREND:'Breakout',TREND_MTF:'Trend',SESSION_BO:'Breakout',VWAP_REVERT:'Mean reversion',SWEEP_REV:'Reversal',HTF_SWEEP:'Reversal',EMA_CROSS:'Trend',SSR:'Reversal',EMA_PB:'Trend'};
  strategies.forEach(s => { s.family=families[s.id]; });
  const agentRoles = [
    ['chart','Market structure','Rules','Reads multiple timeframes and nearby levels.'],
    ['signals','Setup scout','Rules','Evaluates the registered strategy conditions.'],
    ['validator','Independent check','Rules','Checks room and higher-timeframe conflicts.'],
    ['risk','Risk planner','Rules','Reports stop and target plans; optional body-stop control.'],
    ['reentry','Re-entry watch','Rules','Watches for a qualified reclaim after a losing stop.'],
    ['manager','Position manager','Rules','Records changes to an existing paper position.'],
    ['decision','Decision recorder','Rules','Records entries selected by the engine.'],
    ['ai-review','AI second opinion','Optional AI','Shadow review; cannot place or size trades.']
  ].map(([id,name,kind,description])=>({id,name,kind,description}));
  const optIn = new Set(['HTF_SWEEP','EMA_CROSS','SSR','EMA_PB']);
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  function strategyStatus(id, state, lastRun, available) {
    if (!available) return { state:'NO DATA',reason:'Account status has not loaded.',scale:null,enabled:null,reportedAt:null };
    const map = state.cfg && state.cfg.RISK_SCALE || {};
    const scale = finite(map[id]) ? map[id] : optIn.has(id) ? 0 : 1;
    const enabled = !(state.enabled && state.enabled[id] === false) && scale > 0;
    if (!enabled) return {state:'DISABLED',reason:'Disabled flag or zero effective configured scale.',scale,enabled,reportedAt:null};
    const decision = lastRun.decision || {};
    const signal = (Array.isArray(decision.signals) ? decision.signals : []).find(s => s.strategy === id);
    const reject = (Array.isArray(decision.rejects) ? decision.rejects : []).find(s => s.strategy === id);
    let label = 'NOT REPORTED', reason = 'No strategy-specific evaluation record in the latest returned check.';
    if (signal) {label='SETUP REPORTED';reason=String(signal.dir || 'Direction unknown')+' · heuristic score '+String(signal.score ?? 'unknown')+'; execution is separate.';}
    else if (reject) {
      reason=String(reject.reason || 'Reason not supplied');
      label=/waits for.*close/i.test(reason)?'WAITING FOR BAR':/warm|insufficient|missing.*data/i.test(reason)?'DATA BLOCKED':/switched off|disabled/i.test(reason)?'DISABLED':'NOT QUALIFIED';
    }
    return {state:label,reason,scale,enabled,reportedAt:signal||reject ? lastRun.ts || null : null};
  }
  function account(state, lastRun) {
    const available=finite(state.equity), hasPosition=state.pos && typeof state.pos==='object';
    return {available,net:finite(state.stats?.all?.net)?state.stats.all.net:null,
      upnl:finite(lastRun.upnl)?lastRun.upnl:null,
      risk:hasPosition && finite(state.pos.riskAmt)?state.pos.riskAmt:available && state.pos===null?0:null,
      status:!available?'No account data':hasPosition?'Position open':state.pos===null?'Flat':'Position unknown'};
  }
  function operations(state, lastRun, logs, available) {
    const decision=lastRun.decision || {}, ids=new Set(strategies.map(s=>s.id));
    const signals=Array.isArray(decision.signals)?decision.signals.filter(s=>ids.has(s.strategy)):null;
    const rejects=Array.isArray(decision.rejects)?decision.rejects.filter(s=>ids.has(s.strategy)):null;
    const known=signals!==null && rejects!==null;
    const rows=strategies.map(s=>({...s,status:strategyStatus(s.id,state,lastRun,available),signal:signals?.find(x=>x.strategy===s.id)||null,stats:state.stats?.by?.[s.id]||null}));
    const desk=lastRun.desk || {}, providers=Array.isArray(lastRun.ai?.providers)?lastRun.ai.providers:null;
    const records=Array.isArray(logs)?logs:[];
    const roles=agentRoles.map(role=>{
      const record=records.filter(r=>r.agent===role.id).sort((a,b)=>(Date.parse(b.ts)||0)-(Date.parse(a.ts)||0))[0]||null;
      let status='NOT REPORTED';
      if(available){
        if(role.id==='chart' && desk.chart)status='OBSERVED';
        if(role.id==='signals' && known)status='OBSERVED';
        if(role.id==='validator' && typeof desk.validator==='boolean')status=desk.validator?'ENFORCING':'ADVISORY · OFF';
        if(role.id==='risk' && typeof desk.body==='boolean')status=desk.body?'BODY STOP ON':'BODY STOP OFF';
        if(role.id==='reentry' && Object.hasOwn(desk,'reentry'))status=desk.reentry===null?'OFF':desk.reentry?.armed?'ARMED':'WAITING';
        if(role.id==='manager' && record)status='LOG RETURNED';
        if(role.id==='decision' && lastRun.action)status=String(lastRun.action).replaceAll('_',' ');
        if(role.id==='ai-review' && providers)status=providers.length?'SHADOW CONFIGURED':'NOT CONFIGURED';
      }
      return {...role,status,record};
    });
    const traded=rows.filter(r=>finite(r.stats?.n)&&r.stats.n>0&&finite(r.stats.net));
    return {rows,roles,registered:strategies.length,enabled:available?rows.filter(r=>r.status.enabled).length:null,
      qualified:available&&signals!==null?new Set(signals.map(s=>s.strategy)).size:null,
      reported:available&&known?new Set([...signals,...rejects].map(s=>s.strategy)).size:null,
      observedRoles:available?roles.filter(r=>r.record).length:null,providerCount:available&&providers?providers.length:null,
      traded:available?traded.length:null,positive:available?traded.filter(r=>r.stats.net>0).length:null};
  }
  root.DeskBotModel=Object.freeze({strategies,agentRoles,strategyStatus,account,operations,finite});
})(globalThis);
