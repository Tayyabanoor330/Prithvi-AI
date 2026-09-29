const express = require('express');
const path = require('path');
const mqtt = require('mqtt');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;
const mqttUrl = process.env.MQTT_URL;
const deviceToken = process.env.DEVICE_TOKEN || '';
const MAX_HISTORY = 600;
const requestWindows = new Map();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '8kb', strict: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/prithvi', express.static(path.join(__dirname, '..', 'prithvi-ai')));

const latest = {
  updatedAt: new Date().toISOString(),
  source: 'simulation',
  waterValid: true,
  waterLevelCm: null,
  waterDistanceCm: null,
  telemetry: {},
  history: [],
  sensors: {
    mq2: 180,
    mq135: 270,
    rain: 18,
    soil: 38,
    water: 42
  },
  hazard: {
    level: 'low',
    score: 0,
    reasons: []
  }
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function finiteOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function authenticateDevice(req, res, next) {
  if (deviceToken.length < 32) {
    return res.status(503).json({ error: 'Device ingestion is disabled: configure a DEVICE_TOKEN of at least 32 characters.' });
  }
  const supplied = req.get('x-device-token') || '';
  const expectedBuffer = Buffer.from(deviceToken);
  const suppliedBuffer = Buffer.from(supplied);
  const matches = suppliedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!matches) return res.status(401).json({ error: 'Unauthorized device.' });
  next();
}

function limitDeviceRequests(req, res, next) {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  let window = requestWindows.get(key);
  if (!window || now - window.startedAt >= 60000) {
    window = { startedAt: now, count: 0 };
    requestWindows.set(key, window);
  }
  window.count += 1;
  if (window.count > 60) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'Telemetry rate limit exceeded.' });
  }
  if (requestWindows.size > 1000) {
    for (const [address, entry] of requestWindows) {
      if (now - entry.startedAt >= 60000) requestWindows.delete(address);
    }
  }
  next();
}

function validateTelemetryPayload(payload) {
  const hasFinite = (...keys) => keys.some((key) => payload[key] !== undefined
    && payload[key] !== null && Number.isFinite(Number(payload[key])));
  const bounded = (key, min, max) => payload[key] === undefined || payload[key] === null
    || (Number.isFinite(Number(payload[key])) && Number(payload[key]) >= min && Number(payload[key]) <= max);

  if (!hasFinite('mq2Raw', 'mq2') || !hasFinite('mq135Raw', 'mq135')
      || !hasFinite('rainRaw', 'rainIntensity', 'rain')
      || !hasFinite('soilRaw', 'soilMoisture', 'soil')) {
    return 'MQ-2, MQ-135, rain, and soil readings are required and must be numeric.';
  }
  if (payload.waterValid !== false && !hasFinite('waterPercent', 'waterLevelCm', 'waterLevel', 'water')) {
    return 'A water reading is required unless waterValid is false.';
  }
  if (payload.waterValid !== undefined && typeof payload.waterValid !== 'boolean') {
    return 'waterValid must be a boolean.';
  }
  for (const key of ['mq2Raw', 'mq2', 'mq135Raw', 'mq135', 'rainRaw', 'soilRaw']) {
    if (!bounded(key, 0, 4095)) return `${key} must be between 0 and 4095.`;
  }
  for (const key of ['rainIntensity', 'rain', 'soilMoisture', 'soil', 'waterPercent', 'water']) {
    if (!bounded(key, 0, 100)) return `${key} must be between 0 and 100.`;
  }
  if (!bounded('temperature', -40, 80)) return 'temperature is outside the accepted sensor range.';
  if (!bounded('humidity', 0, 100)) return 'humidity must be between 0 and 100.';
  if (!bounded('waterDistanceCm', 0, 400)) return 'waterDistanceCm must be between 0 and 400.';
  if (!bounded('waterLevelCm', 0, 1000)) return 'waterLevelCm must be between 0 and 1000.';
  if (!bounded('floodRisk', 0, 100)) return 'floodRisk must be between 0 and 100.';
  if (!bounded('aqi', 0, 500)) return 'aqi must be between 0 and 500.';
  return null;
}

function normalizePercent(rawValue, direction = 'inverse') {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return 0;

  if (direction === 'direct') {
    return clamp((numeric / 4095) * 100, 0, 100);
  }

  return clamp(((4095 - numeric) / 4095) * 100, 0, 100);
}

function normalizeTelemetry(payload = {}) {
  const source = payload.source || 'esp32';

  const mq2 = Number(payload.mq2Raw ?? payload.mq2 ?? 0);
  const mq135 = Number(payload.mq135Raw ?? payload.mq135 ?? 0);
  const rain = payload.rainIntensity ?? payload.rain;
  const soil = payload.soilMoisture ?? payload.soil;
  const rainPercent = payload.rainRaw !== undefined && payload.rainIntensity === undefined && payload.rain === undefined
    ? normalizePercent(payload.rainRaw)
    : clamp(Number(rain ?? 0), 0, 100);
  const soilPercent = payload.soilRaw !== undefined && payload.soilMoisture === undefined && payload.soil === undefined
    ? normalizePercent(payload.soilRaw)
    : clamp(Number(soil ?? 0), 0, 100);

  const waterValid = payload.waterValid !== false;
  const waterLevelValue = payload.waterLevelCm ?? payload.waterLevel;
  const waterLevelCm = waterLevelValue === undefined || waterLevelValue === null
    ? null
    : Number(waterLevelValue);
  let waterPercent = 0;
  if (waterValid && payload.waterPercent !== undefined && payload.waterPercent !== null) {
    waterPercent = clamp(Number(payload.waterPercent), 0, 100);
  } else if (waterValid && Number.isFinite(waterLevelCm)) {
    const containerHeightCm = Number(payload.containerHeightCm ?? 9);
    waterPercent = containerHeightCm > 0
      ? clamp((waterLevelCm / containerHeightCm) * 100, 0, 100)
      : 0;
  } else if (waterValid && payload.water !== undefined) {
    waterPercent = clamp(Number(payload.water), 0, 100);
  }

  const normalized = {
    mq2: Number.isFinite(mq2) ? mq2 : 0,
    mq135: Number.isFinite(mq135) ? mq135 : 0,
    rain: Number.isFinite(rainPercent) ? rainPercent : 0,
    soil: Number.isFinite(soilPercent) ? soilPercent : 0,
    water: Number.isFinite(waterPercent) ? waterPercent : 0,
    waterValid: waterValid && Number.isFinite(waterPercent),
    waterLevelCm: waterValid && Number.isFinite(waterLevelCm) ? waterLevelCm : null,
    waterDistanceCm: waterValid && Number.isFinite(Number(payload.waterDistanceCm))
      ? Number(payload.waterDistanceCm)
      : null,
    temperature: finiteOrNull(payload.temperature),
    humidity: finiteOrNull(payload.humidity),
    mq2Raw: finiteOrNull(payload.mq2Raw),
    mq135Raw: finiteOrNull(payload.mq135Raw),
    rainRaw: finiteOrNull(payload.rainRaw),
    soilRaw: finiteOrNull(payload.soilRaw),
    floodRisk: finiteOrNull(payload.floodRisk) === null ? null : clamp(Number(payload.floodRisk), 0, 100),
    floodCategory: payload.floodCategory ?? payload.floodStatus ?? null,
    aqi: finiteOrNull(payload.aqi) === null ? null : clamp(Number(payload.aqi), 0, 500),
    aqiCategory: payload.aqiCategory ?? null,
    alert: payload.alert === true,
    source
  };

  if (payload.floodStatus) {
    normalized.floodStatus = String(payload.floodStatus).toUpperCase();
  }

  if (payload.pollutionStatus) {
    normalized.pollutionStatus = String(payload.pollutionStatus).toUpperCase();
  }

  return normalized;
}

function determineHazard(sensors) {
  const reasons = [];
  let score = 0;

  if (Number(sensors.mq2) >= 650) {
    score += 35;
    reasons.push('Combustible gas detected');
  } else if (Number(sensors.mq2) >= 350) {
    score += 15;
    reasons.push('Rising combustible gas');
  }

  if (Number(sensors.mq135) >= 700) {
    score += 30;
    reasons.push('Poor air quality detected');
  } else if (Number(sensors.mq135) >= 450) {
    score += 12;
    reasons.push('Air quality is deteriorating');
  }

  if (Number(sensors.rain) >= 75) {
    score += 25;
    reasons.push('Heavy rainfall detected');
  } else if (Number(sensors.rain) >= 45) {
    score += 10;
    reasons.push('Rainfall is increasing');
  }

  if (Number(sensors.soil) >= 78) {
    score += 25;
    reasons.push('Soil moisture indicates flood risk');
  } else if (Number(sensors.soil) >= 55) {
    score += 10;
    reasons.push('Soil is becoming saturated');
  }

  if (sensors.waterValid !== false && Number(sensors.water) >= 80) {
    score += 35;
    reasons.push('Water level is critical');
  } else if (sensors.waterValid !== false && Number(sensors.water) >= 58) {
    score += 15;
    reasons.push('Water level is rising');
  }

  const level = score >= 60 ? 'critical' : score >= 30 ? 'warning' : 'low';
  return { level, score: Math.min(score, 100), reasons };
}

function updateReadings(sensors, source = 'esp32') {
  const normalized = normalizeTelemetry({ ...sensors, source });
  latest.sensors = {
    mq2: Number(normalized.mq2),
    mq135: Number(normalized.mq135),
    rain: Number(normalized.rain),
    soil: Number(normalized.soil),
    water: Number(normalized.water)
  };
  latest.waterValid = normalized.waterValid;
  latest.waterLevelCm = normalized.waterLevelCm;
  latest.waterDistanceCm = normalized.waterDistanceCm;
  latest.telemetry = {
    temperature: normalized.temperature,
    humidity: normalized.humidity,
    mq2Raw: normalized.mq2Raw,
    mq135Raw: normalized.mq135Raw,
    rainRaw: normalized.rainRaw,
    soilRaw: normalized.soilRaw,
    waterDistanceCm: normalized.waterDistanceCm,
    waterLevelCm: normalized.waterLevelCm,
    waterValid: normalized.waterValid,
    floodRisk: normalized.floodRisk,
    floodCategory: normalized.floodCategory,
    aqi: normalized.aqi,
    aqiCategory: normalized.aqiCategory,
    alert: normalized.alert
  };
  latest.hazard = determineHazard({ ...latest.sensors, waterValid: latest.waterValid });
  latest.source = source;
  latest.updatedAt = new Date().toISOString();
  latest.history.push({
    updatedAt: latest.updatedAt,
    source,
    waterValid: latest.waterValid,
    telemetry: { ...latest.telemetry },
    sensors: { ...latest.sensors },
    hazard: { ...latest.hazard, reasons: [...latest.hazard.reasons] }
  });
  if (latest.history.length > MAX_HISTORY) latest.history.shift();
  return latest;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'hazard-route-command', updatedAt: latest.updatedAt });
});

app.get('/api/readings', (_req, res) => {
  res.json(latest);
});

app.post('/api/readings', limitDeviceRequests, authenticateDevice, (req, res) => {
  const payload = req.body || {};
  const validationError = validateTelemetryPayload(payload);
  if (validationError) return res.status(400).json({ error: validationError });
  const normalized = normalizeTelemetry(payload);
  const hasNumericSensorData = [normalized.mq2, normalized.mq135, normalized.rain, normalized.soil, normalized.water]
    .every((value) => Number.isFinite(value));

  if (!hasNumericSensorData) {
    return res.status(400).json({ error: 'Expected numeric sensor fields or valid ESP32 raw readings.' });
  }

  res.json(updateReadings(normalized, 'esp32'));
});

app.post('/api/simulate', (_req, res) => {
  const isThreatening = latest.hazard.level === 'low';
  const readings = isThreatening
    ? { mq2: 720, mq135: 760, rain: 82, soil: 84, water: 78 }
    : { mq2: 180, mq135: 270, rain: 18, soil: 38, water: 42 };
  res.json(updateReadings(readings, 'simulation'));
});

if (mqttUrl) {
  const mqttClient = mqtt.connect(mqttUrl);
  mqttClient.on('connect', () => {
    mqttClient.subscribe(process.env.MQTT_TOPIC || 'hazards/esp32/readings');
  });
  mqttClient.on('message', (_topic, message) => {
    try {
      const parsed = JSON.parse(message.toString());
      updateReadings(parsed, 'mqtt');
    } catch {
      console.error('Ignored malformed MQTT sensor message');
    }
  });
}

if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Hazard Route Command running on port ${port}`);
    console.log(`Local: http://localhost:${port}`);
    console.log('LAN: use this computer IPv4 address in the ESP32 BACKEND_URL.');
    if (deviceToken.length < 32) {
      console.warn('WARNING: telemetry POST is disabled until DEVICE_TOKEN is set to at least 32 random characters.');
    }
  });
}

module.exports = { app, latest, normalizeTelemetry, determineHazard, updateReadings };
