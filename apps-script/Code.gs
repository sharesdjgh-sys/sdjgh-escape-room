/**
 * Deploy as a web app, executing as the school account.
 * Only doGet and submitApplication are public. Never expose a roster-reading RPC.
 */
const APPLICATION_HEADERS_ = [
  '접수번호', '접수일시', '이름', '재학중학교', '학번', '전화번호',
  '희망회차', '참가자격확인', '개인정보동의', '동의문버전', '요청ID', '요청해시', '중복확인키'
];

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Index');
  const config = publicConfig_();
  const channel = String(e && e.parameter && e.parameter.channel || '');
  config.channel = /^[a-f0-9]{48}$/.test(channel) ? channel : '';
  template.bootstrap = JSON.stringify(config).replace(/</g, '\\u003c');
  return template.evaluate()
    .setTitle('서대전여고 방탈출 체험 신청서')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Run once from the editor attached to the private spreadsheet. */
function setup_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('신청 명단 스프레드시트의 확장 프로그램 > Apps Script에서 실행하세요.');
  const properties = PropertiesService.getScriptProperties();
  const defaults = {
    SPREADSHEET_ID: spreadsheet.getId(),
    SHEET_NAME: '신청명단',
    REGISTRATION_ENABLED: 'false',
    OPEN_AT: '2026-09-28T00:00:00+09:00',
    CLOSE_AT: '2026-10-07T16:00:00+09:00',
    PRIVACY_RETENTION_TEXT: '',
    PRIVACY_VERSION: '2026-01',
    SITE_ORIGIN: ''
  };
  Object.keys(defaults).forEach(function (key) {
    if (properties.getProperty(key) === null) properties.setProperty(key, defaults[key]);
  });
  ensureSheet_(properties.getProperties());
  console.log('초기 설정 완료. SITE_ORIGIN과 PRIVACY_RETENTION_TEXT를 설정하고 배포 안내를 확인하세요.');
}

function configuration_() {
  return PropertiesService.getScriptProperties().getProperties();
}

function state_(properties, now) {
  const openAt = Date.parse(properties.OPEN_AT || '');
  const closeAt = Date.parse(properties.CLOSE_AT || '');
  const configured = Boolean(properties.SPREADSHEET_ID && properties.SHEET_NAME &&
    properties.PRIVACY_RETENTION_TEXT && properties.PRIVACY_VERSION &&
    /^https:\/\/[^\s/?#]+$/.test(properties.SITE_ORIGIN || '') &&
    Number.isFinite(openAt) && Number.isFinite(closeAt) && openAt < closeAt);
  if (!configured || properties.REGISTRATION_ENABLED !== 'true') {
    return { accepting: false, message: '온라인 접수 준비 중입니다.' };
  }
  if (now < openAt) return { accepting: false, message: '아직 신청 기간이 아닙니다. 9월 28일(월)부터 신청할 수 있습니다.' };
  if (now >= closeAt) return { accepting: false, message: '신청 기간이 종료되었습니다. 선정 결과는 개별 안내합니다.' };
  return { accepting: true, message: '신청 기간: 9월 28일(월) ~ 10월 7일(수) 16:00 · 모든 항목을 작성해 주세요.' };
}

function publicConfig_() {
  const properties = configuration_();
  const state = state_(properties, Date.now());
  return {
    accepting: state.accepting,
    message: state.message,
    retentionText: properties.PRIVACY_RETENTION_TEXT || '',
    privacyVersion: properties.PRIVACY_VERSION || '',
    siteOrigin: properties.SITE_ORIGIN || ''
  };
}

function validate_(raw, properties) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('입력 내용을 확인해 주세요.');
  const text = function (key, maximum) {
    if (typeof raw[key] !== 'string' || raw[key].length > maximum) throw new Error('입력 내용을 확인해 주세요.');
    const value = raw[key].trim().normalize('NFC');
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('입력 내용을 확인해 주세요.');
    return value;
  };
  if (raw.website) throw new Error('접수할 수 없습니다. 입력 내용을 확인해 주세요.');
  const payload = {
    requestId: text('requestId', 64),
    name: text('name', 40),
    school: text('school', 60),
    studentNumber: text('studentNumber', 5),
    phone: text('phone', 13),
    session: text('session', 1),
    privacyVersion: text('privacyVersion', 40)
  };
  if (!/^[a-zA-Z0-9-]{16,64}$/.test(payload.requestId)) throw new Error('화면을 새로고침한 후 다시 신청해 주세요.');
  if (!/^3[0-9]{4}$/.test(payload.studentNumber) ||
      Number(payload.studentNumber.slice(1, 3)) < 1 || Number(payload.studentNumber.slice(3)) < 1) {
    throw new Error('학번을 확인해 주세요. 3학년 1반 15번은 30115입니다.');
  }
  if (!/^010-?[0-9]{4}-?[0-9]{4}$/.test(payload.phone)) throw new Error('전화번호는 010-1234-5678 형식으로 입력해 주세요.');
  const digits = payload.phone.replace(/-/g, '');
  payload.phone = digits.slice(0, 3) + '-' + digits.slice(3, 7) + '-' + digits.slice(7);
  if (!/^[1-6]$/.test(payload.session)) throw new Error('희망 회차를 하나 선택해 주세요.');
  if (raw.eligible !== true) throw new Error('중학교 3학년 여학생만 신청할 수 있습니다.');
  if (raw.privacyConsent !== true) throw new Error('개인정보 수집·이용 안내를 읽고 동의해 주세요.');
  if (payload.privacyVersion !== properties.PRIVACY_VERSION) throw new Error('신청 안내가 변경되었습니다. 화면을 새로고침한 후 다시 확인해 주세요.');
  return payload;
}

function digest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (byte) { return ('0' + (byte & 255).toString(16)).slice(-2); }).join('');
}

function sheetText_(value) {
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function ensureSheet_(properties) {
  const spreadsheet = SpreadsheetApp.openById(properties.SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(properties.SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(properties.SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, APPLICATION_HEADERS_.length).setValues([APPLICATION_HEADERS_]);
    sheet.setFrozenRows(1);
  } else {
    const headers = sheet.getRange(1, 1, 1, APPLICATION_HEADERS_.length).getValues()[0];
    if (JSON.stringify(headers) !== JSON.stringify(APPLICATION_HEADERS_)) throw new Error('SHEET_SCHEMA_MISMATCH');
  }
  return sheet;
}

function submitApplication(raw) {
  const properties = configuration_();
  let payload;
  try { payload = validate_(raw, properties); }
  catch (error) { return { ok: false, message: error.message }; }
  if (!properties.SPREADSHEET_ID || !properties.SHEET_NAME) return { ok: false, message: '온라인 접수 준비 중입니다.' };

  const hash = digest_(JSON.stringify(payload));
  const duplicateKey = digest_(payload.school.replace(/\s/g, '').toLowerCase() + ':' + payload.studentNumber);
  const lock = LockService.getScriptLock();
  let acquired = false;
  try {
    acquired = lock.tryLock(10000);
    if (!acquired) return { ok: false, message: '신청이 잠시 몰리고 있습니다. 잠시 후 다시 제출해 주세요.' };
    const sheet = ensureSheet_(properties);
    const count = sheet.getLastRow() - 1;
    const rows = count > 0 ? sheet.getRange(2, 1, count, APPLICATION_HEADERS_.length).getValues() : [];
    // A safe retry returns the original receipt, including after the deadline.
    const existingRequest = rows.find(function (row) { return String(row[10]) === payload.requestId; });
    if (existingRequest) {
      if (String(existingRequest[11]) !== hash) return { ok: false, message: '이전 요청과 내용이 다릅니다. 화면을 새로고침해 주세요.' };
      return { ok: true, receiptId: String(existingRequest[0]) };
    }
    // Re-read the settings inside the lock so a closure takes effect before writing.
    const latest = configuration_();
    const currentState = state_(latest, Date.now());
    if (!currentState.accepting) return { ok: false, message: currentState.message };
    if (latest.PRIVACY_VERSION !== payload.privacyVersion) return { ok: false, message: '신청 안내가 변경되었습니다. 새로고침해 주세요.' };
    if (rows.some(function (row) { return String(row[12]) === duplicateKey; })) {
      return { ok: false, message: '같은 학교와 학번으로 접수된 신청이 있습니다. 이미 신청했다면 다시 제출하지 않아도 됩니다.' };
    }
    const now = new Date();
    const receiptId = 'SDJGH-' + Utilities.formatDate(now, 'Asia/Seoul', 'yyyyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
    const row = [
      receiptId, Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      payload.name, payload.school, payload.studentNumber, payload.phone,
      payload.session, '확인', '동의', payload.privacyVersion, payload.requestId, hash, duplicateKey
    ].map(sheetText_);
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
    return { ok: true, receiptId: receiptId };
  } catch (error) {
    // Do not send spreadsheet IDs, stack traces or applicant data to the browser.
    return { ok: false, message: '저장 상태를 확인하지 못했습니다. 잠시 후 같은 내용으로 다시 시도해 주세요.', uncertain: true };
  } finally {
    if (acquired) lock.releaseLock();
  }
}
