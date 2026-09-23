const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const crypto = require("node:crypto");
const source = fs.readFileSync(require("node:path").join(__dirname, "../apps-script/Code.gs"), "utf8");

function environment(overrides = {}) {
  let now = Date.parse("2026-10-01T12:00:00+09:00");
  let locked = false;
  let flushFails = false;
  const rows = [];
  const properties = {
    SPREADSHEET_ID: "test-private-sheet",
    SHEET_NAME: "신청명단",
    SITE_ORIGIN: "https://example.github.io",
    PRIVACY_RETENTION_TEXT: "테스트용 보유 기간",
    PRIVACY_VERSION: "2026-01",
    REGISTRATION_ENABLED: "true",
    OPEN_AT: "2026-09-28T00:00:00+09:00",
    CLOSE_AT: "2026-10-07T16:00:00+09:00",
    ...overrides
  };
  const sheet = {
    getLastRow: () => rows.length,
    setFrozenRows: () => {},
    getRange(row, column, height, width) {
      return {
        getValues: () => Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => rows[row - 1 + i]?.[column - 1 + j] ?? "")),
        setNumberFormat() { return this; },
        setValues(values) {
          values.forEach((value, i) => {
            rows[row - 1 + i] ||= [];
            value.forEach((cell, j) => { rows[row - 1 + i][column - 1 + j] = cell; });
          });
          return this;
        }
      };
    }
  };
  const book = { getSheetByName: () => rows.length ? sheet : null, insertSheet: () => sheet };
  const context = vm.createContext({
    console,
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return now; }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ ...properties }) }) },
    SpreadsheetApp: {
      openById: () => book,
      flush: () => { if (flushFails) throw new Error("private internal details"); }
    },
    LockService: { getScriptLock: () => ({
      tryLock: () => { if (locked) return false; locked = true; return true; },
      releaseLock: () => { locked = false; }
    }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, text) => [...crypto.createHash("sha256").update(text).digest()],
      formatDate: (_date, _zone, pattern) => pattern === "yyyyMMdd" ? "20261001" : "2026-10-01 12:00:00",
      getUuid: crypto.randomUUID
    }
  });
  vm.runInContext(source, context);
  return {
    context, properties, rows,
    submit: (data) => context.submitApplication(data),
    time: (value) => { now = Date.parse(value); },
    busy: (value) => { locked = value; },
    flushError: (value) => { flushFails = value; }
  };
}

function applicant(overrides = {}) {
  return {
    requestId: crypto.randomUUID(), name: "테스트학생", school: "테스트중학교",
    studentNumber: "30115", phone: "010-0000-0000", session: "1",
    eligible: true, privacyConsent: true, privacyVersion: "2026-01", website: "",
    ...overrides
  };
}

test("stores a valid application with a receipt and preserves phone leading zero", () => {
  const env = environment();
  const result = env.submit(applicant());
  assert.equal(result.ok, true);
  assert.match(result.receiptId, /^SDJGH-20261001-[A-F0-9]{8}$/);
  assert.equal(env.rows.length, 2);
  assert.equal(env.rows[1][5], "010-0000-0000");
  assert.equal(env.rows[1][8], "동의");
});

test("retries return the same receipt without another row, even after the deadline", () => {
  const env = environment();
  const data = applicant();
  const first = env.submit(data);
  env.time("2026-10-08T00:00:00+09:00");
  assert.equal(env.submit(data).receiptId, first.receiptId);
  assert.equal(env.rows.length, 2);
});

test("a request ID cannot be reused for altered content", () => {
  const env = environment();
  const data = applicant();
  env.submit(data);
  assert.equal(env.submit({ ...data, session: "2" }).ok, false);
  assert.equal(env.rows.length, 2);
});

test("duplicates use school and student number, not phone alone", () => {
  const env = environment();
  assert.equal(env.submit(applicant()).ok, true);
  assert.equal(env.submit(applicant({ school: "테스트 중학교" })).ok, false);
  assert.equal(env.submit(applicant({ studentNumber: "30116" })).ok, true);
  assert.equal(env.rows.length, 3);
});

test("fifth applicant to a session is accepted because selection is by lottery", () => {
  const env = environment();
  for (let i = 1; i <= 5; i++) {
    assert.equal(env.submit(applicant({ studentNumber: "3010" + i })).ok, true);
  }
  assert.equal(env.rows.length, 6);
});

test("eligibility, consent, session, student number, and phone are validated on server", () => {
  const invalid = [
    { eligible: false }, { privacyConsent: false }, { session: "7" },
    { studentNumber: "20115" }, { studentNumber: "30015" }, { studentNumber: "30100" },
    { phone: "02-1234-5678" }, { privacyVersion: "old" }, { website: "spam" },
    { name: " " }, { name: "bad\nname" }, { requestId: "short" }
  ];
  for (const change of invalid) {
    const env = environment();
    assert.equal(env.submit(applicant(change)).ok, false, JSON.stringify(change));
    assert.equal(env.rows.length, 0);
  }
});

test("rejects new applications outside the period and when consent configuration is missing", () => {
  for (const overrides of [{ REGISTRATION_ENABLED: "false" }, { PRIVACY_RETENTION_TEXT: "" }, { SITE_ORIGIN: "" }]) {
    const env = environment(overrides);
    assert.equal(env.submit(applicant()).ok, false);
    assert.ok(env.rows.length <= 1);
  }
  const env = environment();
  env.time("2026-09-27T23:59:59+09:00");
  assert.equal(env.submit(applicant()).ok, false);
  env.time("2026-10-07T16:00:00+09:00");
  assert.equal(env.submit(applicant()).ok, false);
});

test("lock contention returns an error without writing", () => {
  const env = environment();
  env.busy(true);
  assert.equal(env.submit(applicant()).ok, false);
  assert.equal(env.rows.length, 0);
});

test("formula-like user text cannot become a spreadsheet formula", () => {
  const env = environment();
  assert.equal(env.submit(applicant({ name: "=1+1", school: "@test" })).ok, true);
  assert.equal(env.rows[1][2], "'=1+1");
  assert.equal(env.rows[1][3], "'@test");
});

test("uncertain save can be retried without duplicates or leaked internal errors", () => {
  const env = environment();
  const data = applicant();
  env.flushError(true);
  const uncertain = env.submit(data);
  assert.equal(uncertain.uncertain, true);
  assert.ok(!uncertain.message.includes("private"));
  env.flushError(false);
  assert.equal(env.submit(data).ok, true);
  assert.equal(env.rows.length, 2);
});
