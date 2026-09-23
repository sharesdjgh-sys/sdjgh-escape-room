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
    studentNumber: "30115", phone: "010-0000-0000", sessions: ["1"],
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
  assert.equal(env.submit({ ...data, sessions: ["2"] }).ok, false);
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
    { eligible: false }, { privacyConsent: false }, { sessions: ["7"] },
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

test("stores multiple sessions sorted in the existing cell with one application row", () => {
  const env = environment();
  const result = env.submit(applicant({ sessions: ["6", "1", "3"] }));
  assert.equal(result.ok, true);
  assert.equal(env.rows.length, 2);
  assert.equal(env.rows[1][6], "1, 3, 6");
  assert.equal(env.rows[0][6], "희망회차");
  assert.equal(env.rows[1].length, 13);
});

test("accepts all six sessions and preserves duplicate prevention across selections", () => {
  const env = environment();
  assert.equal(env.submit(applicant({ sessions: ["1", "2", "3", "4", "5", "6"] })).ok, true);
  assert.equal(env.rows[1][6], "1, 2, 3, 4, 5, 6");
  assert.equal(env.submit(applicant({ sessions: ["2", "4"] })).ok, false);
  assert.equal(env.rows.length, 2);
});

test("rejects empty, malformed, duplicate, and out-of-range session selections", () => {
  const invalid = [[], null, "1,3", ["1", "7"], ["1", "1"], [1], [" 1"], [{}], new Array(1), ["1", "2", "3", "4", "5", "6", "1"]];
  for (const sessions of invalid) {
    const env = environment();
    assert.equal(env.submit(applicant({ sessions })).ok, false, JSON.stringify(sessions));
    assert.equal(env.rows.length, 0);
  }
  const env = environment();
  const missing = applicant();
  delete missing.sessions;
  assert.equal(env.submit(missing).ok, false);
  // A malformed modern field must not be bypassed by adding a legacy field.
  assert.equal(env.submit(applicant({ sessions: [], session: "1" })).ok, false);
});

test("multiple-session retries are order independent, including uncertain writes", () => {
  const env = environment();
  const data = applicant({ sessions: ["5", "1", "3"] });
  env.flushError(true);
  assert.equal(env.submit(data).uncertain, true);
  env.flushError(false);
  env.time("2026-10-08T00:00:00+09:00");
  const retried = env.submit({ ...data, sessions: ["3", "5", "1"] });
  assert.equal(retried.ok, true);
  assert.equal(retried.receiptId, env.rows[1][0]);
  assert.equal(env.rows.length, 2);
  assert.equal(env.submit({ ...data, sessions: ["1", "3"] }).ok, false);
});

test("legacy single-session forms and saved request hashes remain compatible", () => {
  const env = environment();
  const legacy = applicant();
  delete legacy.sessions;
  legacy.session = "2";
  const result = env.submit(legacy);
  assert.equal(result.ok, true);
  assert.equal(env.rows[1][6], "2");
  const oldPayload = {
    requestId: legacy.requestId, name: legacy.name, school: legacy.school,
    studentNumber: legacy.studentNumber, phone: legacy.phone,
    session: "2", privacyVersion: legacy.privacyVersion
  };
  const oldHash = crypto.createHash("sha256").update(JSON.stringify(oldPayload)).digest("hex");
  assert.equal(env.rows[1][11], oldHash);
  env.time("2026-10-08T00:00:00+09:00");
  assert.equal(env.submit({ ...legacy, sessions: ["2"] }).receiptId, result.receiptId);
  assert.equal(env.rows.length, 2);
});
