const test = require('node:test');
const assert = require('node:assert/strict');
const TEST_DEVICE_TOKEN = 'test-device-token-12345678901234567890';
process.env.DEVICE_TOKEN = TEST_DEVICE_TOKEN;
const { app, normalizeTelemetry, determineHazard, updateReadings } = require('../server.js');

test('normalizes the ESP32 payload into dashboard-safe sensor values', () => {
  const payload = {
    temperature: 28.3,
    humidity: 62.5,
    mq2Raw: 1200,
    mq135Raw: 900,
    rainRaw: 2500,
    soilRaw: 1700,
    waterLevel: 6.8,
    floodStatus: 'WARNING',
    pollutionStatus: 'HIGH'
  };

  const normalized = normalizeTelemetry(payload);

  assert.equal(normalized.mq2, 1200);
  assert.equal(normalized.mq135, 900);
  assert.ok(normalized.rain >= 0 && normalized.rain <= 100);
  assert.ok(normalized.soil >= 0 && normalized.soil <= 100);
  assert.ok(normalized.water >= 0 && normalized.water <= 100);
  assert.equal(normalized.waterValid, true);
  assert.equal(normalized.waterLevelCm, 6.8);
  assert.equal(normalized.source, 'esp32');
});

test('keeps normalized sensor percentages and marks a failed water echo unavailable', () => {
  const normalized = normalizeTelemetry({
    mq2Raw: 100,
    mq135Raw: 200,
    rainIntensity: 25,
    soilMoisture: 40,
    waterValid: false,
    waterLevelCm: null,
    waterPercent: null
  });

  assert.equal(normalized.rain, 25);
  assert.equal(normalized.soil, 40);
  assert.equal(normalized.water, 0);
  assert.equal(normalized.waterValid, false);
  assert.equal(normalized.waterLevelCm, null);
  assert.equal(determineHazard({ ...normalized, water: 100 }).score, 0);

  const current = updateReadings({
    mq2Raw: 100,
    mq135Raw: 200,
    rainIntensity: 25,
    soilMoisture: 40,
    waterValid: false,
    waterLevelCm: null,
    waterPercent: null
  });
  assert.equal(current.waterValid, false);
  assert.equal(current.hazard.score, 0);
});

test('computes hazard level from raw ESP32 signals', () => {
  const score = determineHazard({ mq2: 1100, mq135: 850, rain: 74, soil: 69, water: 76 });
  assert.ok(['low', 'warning', 'critical'].includes(score.level));
  assert.ok(score.score >= 0);
});

test('protects telemetry writes and rejects out-of-range raw sensor data', async (t) => {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const payload = {
    temperature: 28,
    humidity: 60,
    mq2Raw: 420,
    mq135Raw: 510,
    rainRaw: 2700,
    soilRaw: 1800,
    rainIntensity: 34,
    soilMoisture: 56,
    waterValid: false,
    waterDistanceCm: null,
    waterLevelCm: null,
    waterPercent: null,
    floodRisk: 18,
    aqi: 72,
    alert: false
  };

  const unauthorized = await fetch(`${baseUrl}/api/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(unauthorized.status, 401);

  const accepted = await fetch(`${baseUrl}/api/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': TEST_DEVICE_TOKEN },
    body: JSON.stringify(payload)
  });
  assert.equal(accepted.status, 200);
  const readings = await accepted.json();
  assert.equal(readings.source, 'esp32');
  assert.equal(readings.telemetry.waterValid, false);
  assert.equal(readings.telemetry.mq2Raw, 420);

  const invalid = await fetch(`${baseUrl}/api/readings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Token': TEST_DEVICE_TOKEN },
    body: JSON.stringify({ ...payload, mq2Raw: 5000 })
  });
  assert.equal(invalid.status, 400);
});
