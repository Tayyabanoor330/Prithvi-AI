/* ==========================================================================
   PRITHVI AI — Simulated Sensor Engine
   Produces realistic mock readings for Flood / Forest Fire / Pollution.
   In Demo Mode it runs a scripted "event" on a rotating hazard so the whole
   pipeline (metrics -> risk score -> alert -> UI) visibly moves through
   Normal -> Warning -> High Risk -> Critical and back down.
   This module owns no DOM — dashboard.js / monitoring.js / warnings.js
   subscribe to it and render.
   ========================================================================== */

(function(){

  const HAZARDS = ["flood","fire","pollution"];
  const HISTORY_LEN = 60;

  const baseline = {
    flood:      { waterLevel:1.2, rainfall:4,  riseRate:0.02, flowRate:18 },
    fire:       { temperature:29, humidity:48, smoke:6,       wind:9 },
    pollution:  { aqi:62,         pm25:28,     pm10:55,       visibility:6.4 },
  };

  const state = {
    values: JSON.parse(JSON.stringify(baseline)),
    history: { flood:[], fire:[], pollution:[] },
    risk: { flood:"normal", fire:"normal", pollution:"normal", overall:"normal" },
    riskScore: { flood:5, fire:5, pollution:8 },
    trend: { flood:"flat", fire:"flat", pollution:"flat" },
    route: { mode:"normal", title:"Primary route active", route:"Route A — Main corridor remains open", shelter:"Rain shelter not required", note:"No flood reroute required." },
    event: null,          // { hazard, phase:'rising'|'recovering', elapsed, duration }
    listeners: [],
    loopHandle: null,
    demo: false,
    demoFloodShown: false,
    demoPaused: false,
    demoScenario: null,
    hardwareMode: false,
    device: { status:"waiting", connected:false, updatedAt:null, telemetry:null, error:null },
    hardwareHistory: [],
  };

  function normalizeHardwarePayload(payload){
    if(!payload || typeof payload !== "object") return null;

    const rainRaw = Number(payload.rainRaw ?? payload.rain ?? 0);
    const soilRaw = Number(payload.soilRaw ?? payload.soil ?? 0);
    const waterLevelCm = Number(payload.waterLevel ?? payload.water ?? 0);
    const mq2Raw = Number(payload.mq2Raw ?? payload.mq2 ?? 0);
    const mq135Raw = Number(payload.mq135Raw ?? payload.mq135 ?? 0);
    const temperature = Number(payload.temperature ?? 29);
    const humidity = Number(payload.humidity ?? 48);

    const waterLevelM = Number.isFinite(waterLevelCm) ? clamp(waterLevelCm / 100, 0.2, 8) : 1.2;
    const rainfallPercent = Number.isFinite(rainRaw) ? clamp(((4095 - rainRaw) / 4095) * 100, 0, 100) : 4;
    const soilPercent = Number.isFinite(soilRaw) ? clamp(((4095 - soilRaw) / 4095) * 100, 0, 100) : 38;
    const floodLevel = Number.isFinite(waterLevelCm) ? clamp((waterLevelCm / 9) * 100, 0, 100) : 18;

    return {
      flood: {
        waterLevel: clamp(waterLevelM, 0.2, 8),
        rainfall: clamp(rainfallPercent, 0, 90),
        riseRate: clamp(waterLevelCm > 4 ? 0.25 : 0.02, 0, 1),
        flowRate: clamp(Math.round((waterLevelCm * 2.4) + (rainfallPercent * 1.2)), 0, 220),
      },
      fire: {
        temperature: clamp(Number.isFinite(temperature) ? temperature : 29, 18, 60),
        humidity: clamp(Number.isFinite(humidity) ? humidity : 48, 8, 90),
        smoke: clamp((mq2Raw / 10) || 6, 0, 100),
        wind: clamp((rainfallPercent * 0.1) + 5, 0, 55),
      },
      pollution: {
        aqi: clamp(Number.isFinite(mq135Raw) ? mq135Raw * 0.45 : 62, 15, 420),
        pm25: clamp(Number.isFinite(mq135Raw) ? mq135Raw * 0.22 : 28, 5, 260),
        pm10: clamp(Number.isFinite(mq2Raw) ? mq2Raw * 0.33 : 55, 10, 400),
        visibility: clamp(10 - ((Number.isFinite(mq135Raw) ? mq135Raw * 0.45 : 62) / 50), 0.3, 10),
      },
      floodLevel,
      soilPercent,
    };
  }

  function deriveRouteDecision(floodValues){
    const floodRisk = Number(floodValues.waterLevel) > 2.8 || Number(floodValues.rainfall) > 65;
    if(floodRisk){
      return {
        mode:"reroute",
        title:"Rain shelter reroute active",
        route:"Route B — Elevated rain shelter via Ridge Road",
        shelter:"Shelter: Community Hall, Ridge Road (2.1 km, high ground)",
        note:"Low-lying roads are flooding. Move to the higher ground shelter and avoid standing water.",
      };
    }
    return {
      mode:"normal",
      title:"Primary route active",
      route:"Route A — Main corridor remains open",
      shelter:"Rain shelter not required",
      note:"Conditions are stable and the usual route remains safe.",
    };
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

  /* ---- risk scoring per hazard, returns {score(0-100), level} ---- */
  function scoreFlood(v){
    let s = clamp((v.waterLevel - 1) / (6 - 1) * 100, 0, 100);
    s += clamp(v.riseRate * 40, 0, 25);
    return clamp(s, 0, 100);
  }
  function scoreFire(v){
    let s = clamp((v.temperature - 25) / (55 - 25) * 60, 0, 60);
    s += clamp(v.smoke / 100 * 30, 0, 30);
    s += clamp((v.wind - 5) / 40 * 15, 0, 15);
    s -= clamp((v.humidity - 40) / 60 * 10, 0, 10);
    return clamp(s, 0, 100);
  }
  function scorePollution(v){
    return clamp(v.aqi / 400 * 100, 0, 100);
  }
  const scorers = { flood:scoreFlood, fire:scoreFire, pollution:scorePollution };

  function levelFromScore(s){
    if(s < 25) return "normal";
    if(s < 50) return "warning";
    if(s < 75) return "high";
    return "critical";
  }

  /* ---- random-walk one hazard's raw values toward (optional) a target bias ---- */
  function driftHazard(hazard, bias){
    const v = state.values[hazard];
    bias = bias || 0; // -1 recover, 0 idle noise, +1 escalate

    if(hazard === "flood"){
      v.riseRate = clamp(v.riseRate + (bias*0.06) + PRITHVI.rand(-0.01,0.01), -0.05, 0.9);
      v.waterLevel = clamp(v.waterLevel + v.riseRate*0.35 + PRITHVI.rand(-0.02,0.02), 0.3, 8);
      v.rainfall = clamp(v.rainfall + bias*4 + PRITHVI.rand(-1,1), 0, 90);
      v.flowRate = clamp(v.flowRate + bias*6 + PRITHVI.rand(-2,2), 5, 220);
    } else if(hazard === "fire"){
      v.temperature = clamp(v.temperature + bias*1.4 + PRITHVI.rand(-0.4,0.4), 18, 60);
      v.humidity = clamp(v.humidity - bias*2 + PRITHVI.rand(-1,1), 8, 90);
      v.smoke = clamp(v.smoke + bias*5 + PRITHVI.rand(-1,1), 0, 100);
      v.wind = clamp(v.wind + bias*1.2 + PRITHVI.rand(-1,1), 0, 55);
    } else if(hazard === "pollution"){
      v.aqi = clamp(v.aqi + bias*12 + PRITHVI.rand(-3,3), 15, 420);
      v.pm25 = clamp(v.aqi*0.45 + PRITHVI.rand(-3,3), 5, 260);
      v.pm10 = clamp(v.aqi*0.75 + PRITHVI.rand(-4,4), 10, 400);
      v.visibility = clamp(10 - (v.aqi/45) + PRITHVI.rand(-0.2,0.2), 0.3, 10);
    }
  }

  function pushHistory(hazard){
    const arr = state.history[hazard];
    arr.push(Object.assign({t: Date.now()}, state.values[hazard], {score: state.riskScore[hazard]}));
    if(arr.length > HISTORY_LEN) arr.shift();
  }

  function updateRisk(hazard){
    const prevScore = state.riskScore[hazard];
    let s = scorers[hazard](state.values[hazard]);
    if(state.hardwareMode && state.device.telemetry){
      const t = state.device.telemetry;
      if(hazard === "flood"){
        s = Number.isFinite(t.floodRisk) ? clamp(t.floodRisk,0,100) :
          clamp((t.waterPercent || 0)*0.55 + (t.rainPercent || 0)*0.3 + (t.soilPercent || 0)*0.15,0,100);
      } else if(hazard === "fire"){
        const temperature = Number.isFinite(t.temperature) ? t.temperature : 20;
          const smokeSignal = Number.isFinite(t.mq2Raw)
            ? (t.mq2Raw >= 1050 ? 80 : t.mq2Raw >= 700 ? 50 : t.mq2Raw >= 500 ? 25 : t.mq2Raw/20)
            : 0;
          s = clamp(clamp((temperature-25)/30*55,0,55) + smokeSignal*0.45,0,100);
      } else if(hazard === "pollution"){
          s = Number.isFinite(t.aqi) ? clamp(t.aqi/400*100,0,100) :
          clamp((t.mq135Raw || 0)/4095*100,0,100);
      }
    }
    state.riskScore[hazard] = s;
    state.risk[hazard] = levelFromScore(s);
    const delta = s - prevScore;
    state.trend[hazard] = delta > 1.2 ? "up" : (delta < -1.2 ? "down" : "flat");
  }

  function updateOverall(){
    const order = {normal:0, warning:1, high:2, critical:3};
    let worst = "normal";
    HAZARDS.forEach(h=>{ if(order[state.risk[h]] > order[worst]) worst = state.risk[h]; });
    state.risk.overall = worst;
    state.route = state.hardwareMode
      ? (state.risk.flood === "high" || state.risk.flood === "critical"
        ? { mode:"reroute", title:"Rain shelter reroute active", route:"Route B — Elevated rain shelter via Ridge Road", shelter:"Shelter: Community Hall, Ridge Road (2.1 km, high ground)", note:"Live ESP32 flood-risk readings indicate elevated risk. Avoid low-lying roads and standing water." }
        : state.risk.flood === "warning"
          ? { mode:"warning", title:"Flood conditions require monitoring", route:"Route A remains active; check access to the elevated Route B", shelter:"Identify the nearest high-ground shelter", note:"The edge model reports rising flood risk. Avoid drains and low crossings, and prepare to move if conditions worsen." }
          : { mode:"normal", title:"Primary route active", route:"Route A — Main corridor remains open", shelter:"Rain shelter not required", note:"ESP32 flood model currently reports low risk." })
      : deriveRouteDecision(state.values.flood);
  }

  function asFinite(value){
    const number = Number(value);
    return value === null || value === undefined || value === "" || !Number.isFinite(number) ? null : number;
  }

  function buildHardwareSample(entry){
    const t = entry.telemetry || entry;
    const sensors = entry.sensors || {};
    const waterValid = entry.waterValid !== false && t.waterValid !== false;
    const rainPercent = asFinite(t.rainIntensity) ?? asFinite(sensors.rain) ?? 0;
    const soilPercent = asFinite(t.soilMoisture) ?? asFinite(sensors.soil) ?? 0;
    const waterLevelCm = waterValid ? (asFinite(t.waterLevelCm) ?? 0) : null;
    const mq2Raw = asFinite(t.mq2Raw) ?? asFinite(sensors.mq2) ?? 0;
    const mq135Raw = asFinite(t.mq135Raw) ?? asFinite(sensors.mq135) ?? 0;
    const aqi = asFinite(t.aqi);
    const temperature = asFinite(t.temperature);
    const humidity = asFinite(t.humidity);
    const floodRisk = asFinite(t.floodRisk);
    const waterPercent = waterValid
      ? (asFinite(t.waterPercent) ?? asFinite(sensors.water) ?? 0)
      : null;
    const timestamp = Date.parse(entry.updatedAt || new Date().toISOString());

    return {
      t: Number.isFinite(timestamp) ? timestamp : Date.now(),
      telemetry: {
        temperature, humidity, mq2Raw, mq135Raw,
        rainRaw:asFinite(t.rainRaw), soilRaw:asFinite(t.soilRaw),
        rainPercent, soilPercent, waterValid,
        waterDistanceCm:waterValid ? asFinite(t.waterDistanceCm) : null,
        waterLevelCm, waterPercent, floodRisk,
        floodCategory:t.floodCategory || null, aqi,
        aqiCategory:t.aqiCategory || null, alert:t.alert === true,
      },
      values: {
        flood:{ waterLevel:waterLevelCm, rainfall:rainPercent, riseRate:null, flowRate:null },
        fire:{ temperature, humidity, smoke:mq2Raw, wind:null },
        pollution:{ aqi, pm25:null, pm10:null, visibility:null },
      },
      scores:{
        flood:floodRisk,
        fire:temperature === null && mq2Raw === null ? null : clamp((temperature === null ? 0 : (temperature-25)/30*55) + (mq2Raw >= 1050 ? 80 : mq2Raw >= 700 ? 50 : mq2Raw >= 500 ? 25 : mq2Raw/20)*0.45,0,100),
        pollution:aqi === null ? null : clamp(aqi/400*100,0,100),
      }
    };
  }

  function ingestHardware(payload){
    if(!payload || payload.source !== "esp32") return false;
    const updatedAt = payload.updatedAt || null;
    const timestamp = Date.parse(updatedAt || "");
    if(!Number.isFinite(timestamp) || Date.now()-timestamp > 15000 || timestamp > Date.now()+5000){
      setHardwareStatus("stale", "Last ESP32 reading is older than 15 seconds.");
      return false;
    }
    if(state.demo) return false;
    if(state.device.updatedAt === updatedAt && state.device.connected) return true;

    const records = Array.isArray(payload.history)
      ? payload.history.filter(item=>item.source === "esp32").slice(-HISTORY_LEN)
      : [];
    if(records.length){
      state.history = { flood:[], fire:[], pollution:[] };
      records.forEach(record=>{
        const sample = buildHardwareSample(record);
        HAZARDS.forEach(hazard=>{
          const values = sample.values[hazard];
          const score = sample.scores[hazard];
          if(score === null) return;
          state.history[hazard].push(Object.assign({t:sample.t}, values, {score}));
        });
      });
    }

    const sample = buildHardwareSample(payload);
    const hardwareHistory = records.map(buildHardwareSample);
    hardwareHistory.push(sample);
    state.hardwareHistory = hardwareHistory
      .filter((item,index,list)=>list.findIndex(candidate=>candidate.t === item.t) === index)
      .slice(-HISTORY_LEN)
      .map(item=>({t:item.t, ...item.telemetry}));
    const previousFlood = state.values.flood.waterLevel;
    const previousTime = state.device.updatedAt ? Date.parse(state.device.updatedAt) : null;
    const hadHardwareSample = state.hardwareMode && Number.isFinite(previousTime);
    if(hadHardwareSample && Number.isFinite(sample.values.flood.waterLevel) && Number.isFinite(previousFlood) && previousTime && sample.t > previousTime){
      sample.values.flood.riseRate = clamp((sample.values.flood.waterLevel-previousFlood)*3600000/(sample.t-previousTime),-100,100);
    }
    state.hardwareMode = true;
    state.device = { status:"connected", connected:true, updatedAt, telemetry:sample.telemetry, error:null };
    state.values = sample.values;
    HAZARDS.forEach(hazard=>{
      if(sample.scores[hazard] !== null){
        const old = state.riskScore[hazard];
        state.riskScore[hazard] = sample.scores[hazard];
        state.risk[hazard] = levelFromScore(sample.scores[hazard]);
        state.trend[hazard] = !hadHardwareSample ? "flat" :
          sample.scores[hazard] > old+1.2 ? "up" : sample.scores[hazard] < old-1.2 ? "down" : "flat";
      } else {
        state.riskScore[hazard] = 0;
        state.risk[hazard] = "normal";
        state.trend[hazard] = "flat";
      }
      if(sample.scores[hazard] !== null){
        const point = Object.assign({t:sample.t}, sample.values[hazard], {score:sample.scores[hazard]});
        const history = state.history[hazard];
        if(!history.length || history[history.length-1].t !== sample.t) history.push(point);
        if(history.length > HISTORY_LEN) history.shift();
      }
    });
    updateOverall();
    notify();
    return true;
  }

  function setHardwareStatus(status, error){
    const connected = status === "connected";
    if(state.device.status === status && state.device.error === (error || null)) return;
    state.device.status = status;
    state.device.connected = connected;
    state.device.error = error || null;
    notify();
  }

  /* ---- demo-mode scripted event: pick a hazard, ramp up, then recover ---- */
  function maybeStartEvent(){
    if(state.event) return;
    if(state.demoPaused) return;
    if(state.demoScenario === "pollution"){
      state.event = { hazard:"pollution", phase:"rising", elapsed:0, duration: PRITHVI.rand(10,16) };
      return;
    }
    if(state.demo && !state.demoFloodShown){
      state.demoFloodShown = true;
      state.event = { hazard:"flood", phase:"rising", elapsed:0, duration: PRITHVI.rand(14,22) };
      return;
    }
    if(Math.random() < 0.35){
      state.event = { hazard:HAZARDS[Math.floor(Math.random()*HAZARDS.length)], phase:"rising", elapsed:0, duration: PRITHVI.rand(14,22) };
    }
  }

  function stepEvent(dtSec){
    if(!state.event) return;
    const ev = state.event;
    ev.elapsed += dtSec;
    const bias = ev.phase === "rising" ? 1 : 0;
    driftHazard(ev.hazard, bias);
    if(ev.phase === "rising" && ev.elapsed >= ev.duration){
      ev.phase = "holding"; ev.elapsed = 0;
    }
  }

  function resetDemo(){
    if(!state.demo && state.hardwareMode) return;
    state.values = JSON.parse(JSON.stringify(baseline));
    state.history = { flood:[], fire:[], pollution:[] };
    state.risk = { flood:"normal", fire:"normal", pollution:"normal", overall:"normal" };
    state.riskScore = { flood:5, fire:5, pollution:8 };
    state.trend = { flood:"flat", fire:"flat", pollution:"flat" };
    state.event = null;
    state.demoFloodShown = false;
    state.demoPaused = true;
    state.demoScenario = null;
    for(let i=0;i<HISTORY_LEN;i++){
      HAZARDS.forEach(h=>{ updateRisk(h); pushHistory(h); });
    }
    updateOverall();
    notify();
  }

  /* ---- one full sample tick across all hazards ---- */
  function sampleOnce(dtSec){
    dtSec = dtSec || 1;
    HAZARDS.forEach(h=>{
      const isEventHazard = state.event && state.event.hazard === h;
      if(!isEventHazard) driftHazard(h, 0);
    });
    stepEvent(dtSec);
    HAZARDS.forEach(h=>{ updateRisk(h); pushHistory(h); });
    updateOverall();
    notify();
  }

  function notify(){
    state.listeners.forEach(fn=>{ try{ fn(state); }catch(e){ console.error(e); } });
  }

  function startLoop(){
    if(state.loopHandle) return;
    state.loopHandle = setInterval(()=>{
      maybeStartEvent();
      sampleOnce(1.2);
    }, 1200);
  }
  function stopLoop(){
    if(state.loopHandle){ clearInterval(state.loopHandle); state.loopHandle = null; }
  }

  // seed some history so charts aren't empty on first paint
  for(let i=0;i<HISTORY_LEN;i++){
    HAZARDS.forEach(h=>{ updateRisk(h); pushHistory(h); });
  }
  updateOverall();

  PRITHVI.sensors = {
    HAZARDS,
    getState: ()=> state,
    subscribe(fn){ state.listeners.push(fn); },
    setDemo(on){
      state.demo = on;
      if(on){
        state.hardwareMode = false;
        state.values = JSON.parse(JSON.stringify(baseline));
        state.history = { flood:[], fire:[], pollution:[] };
        state.device = { status:"waiting", connected:false, updatedAt:null, telemetry:null, error:null };
        state.demoPaused = false;
        state.demoFloodShown = false;
        HAZARDS.forEach(hazard=>{ updateRisk(hazard); pushHistory(hazard); });
        updateOverall();
        startLoop();
      } else {
        stopLoop();
        state.device = { status:"waiting", connected:false, updatedAt:null, telemetry:null, error:null };
      }
      notify();
    },
    startScenario(scenario){
      this.setDemo(true);
      state.demoScenario = scenario === "pollution" ? "pollution" : "flood";
      state.event = null;
      state.demoFloodShown = state.demoScenario === "pollution";
      if(state.demoScenario === "pollution"){
        state.values.pollution = { aqi:62, pm25:28, pm10:55, visibility:6.4 };
      } else {
        state.values.flood = { waterLevel:1.2, rainfall:4, riseRate:0.02, flowRate:18 };
      }
      updateOverall();
      notify();
      startLoop();
    },
    resetDemo,
    refreshOnce(){ sampleOnce(1); }, // manual "Refresh readings" — small variation, no event
    ingestHardware,
    setHardwareStatus,
    levelFromScore,
  };

})();
