-- ============================================
-- fun sport nexus 2026.12 申込システム データベーススキーマ
-- Cloudflare D1 (SQLite)
-- ============================================
--
-- 【2026-07-02 正本化メモ】
-- 本ファイルはコード（src/pages 配下の SQL）から復元した「コードが要求する完全スキーマ」です。
-- 従来この schema.sql には slots / entries / email_logs / entry_slots の4テーブルしか
-- 定義されておらず、コードが実際に使う entry_attendees / entry_checkins / audit_log / email_log と
-- entries・entry_slots の追加カラムが未記載でした（本番D1へは手動適用済みと推測）。
-- 障害時の再構築とローカル再現のため、コードの参照に合わせて補完しています。
--
-- 【要対応】本番D1（fsn-apply-db）の実スキーマと必ず突き合わせてください。
--   実スキーマの取得: npx wrangler d1 execute fsn-apply-db --remote \
--     --command "SELECT sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY name"
--   カラムの型・DEFAULT・制約が本番と異なる場合は本ファイルを本番側に合わせて修正すること。
--
-- 【技術的負債メモ】メール系テーブルが2つあります。
--   email_logs … 申込/キャンセルメールの送信失敗追跡・手動再送用（軍神設計。現状コードから未使用）
--   email_log  … 一斉メール（email-blast）の送信履歴。名前もカラムも別物。
--   将来的に命名・役割を整理することを推奨。
-- ============================================

-- スロット（プログラム×時間枠）
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                  -- 例: d1-legit-1
  program_code TEXT NOT NULL,                  -- 例: legit-dance（同種目グルーピング用）
  program_name TEXT NOT NULL,                  -- 例: Legit ダンス ①
  day TEXT NOT NULL,                           -- 'Day1' or 'Day2'
  date TEXT NOT NULL,                          -- '2026-12-19' or '2026-12-20'
  time_start TEXT NOT NULL,                    -- '10:00'
  time_end TEXT NOT NULL,                      -- '11:00'
  venue TEXT NOT NULL,                         -- '第4体育室'
  capacity INTEGER NOT NULL DEFAULT 30,
  description TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,        -- 0=非表示
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_slots_program_code ON slots(program_code);
CREATE INDEX IF NOT EXISTS idx_slots_day ON slots(day);
CREATE INDEX IF NOT EXISTS idx_slots_sort ON slots(sort_order);

-- 申込（1申込＝1ユーザーの送信）
CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  qr_token TEXT UNIQUE,                        -- 当日受付QR用ユニーク値
  applicant_name TEXT NOT NULL,
  applicant_furigana TEXT NOT NULL,
  email TEXT NOT NULL,
  tel TEXT NOT NULL,
  attendees INTEGER NOT NULL DEFAULT 1,
  attendee_attr TEXT,                          -- 参加者属性（カンマ区切り）
  remarks TEXT,
  consent_photo INTEGER NOT NULL DEFAULT 0,
  consent_allergy INTEGER NOT NULL DEFAULT 0,
  consent_rules INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed',    -- confirmed / cancelled
  checked_in_at TEXT,                          -- 当日受付チェックイン時刻（初回）
  checkin_day TEXT,                            -- 初回チェックインした開催日（Day1/Day2）
  cancelled_at TEXT,                           -- キャンセル日時
  cancel_reason TEXT,                          -- キャンセル理由
  panshoku_extras TEXT,                        -- 当日同行者（ぱん食い）のJSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_email ON entries(email);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_qr_token ON entries(qr_token);

-- 参加者（1申込に複数名。申込者本人＋同行者）
CREATE TABLE IF NOT EXISTS entry_attendees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,          -- 申込内の並び順
  name TEXT NOT NULL,
  furigana TEXT,
  birth_date TEXT,                              -- 生年月日
  grade TEXT,                                   -- 学年
  is_representative INTEGER NOT NULL DEFAULT 0, -- 1=申込者本人
  panshoku_join INTEGER NOT NULL DEFAULT 0,     -- ぱん食い競走に参加
  panshoku_allergy_ok INTEGER NOT NULL DEFAULT 0, -- アレルギー同意
  panshoku_confirmed_at TEXT,                   -- ぱん食い参加意思の確認日時
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entry_attendees_entry ON entry_attendees(entry_id);

-- 申込×スロット（中間テーブル：1参加者×1スロット）
CREATE TABLE IF NOT EXISTS entry_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  attendee_id INTEGER,                          -- どの参加者の予約か（entry_attendees.id）
  attendees INTEGER NOT NULL DEFAULT 1,        -- そのスロットに何名分（通常1）
  attended INTEGER NOT NULL DEFAULT 0,         -- 事前出欠/当日出欠（1=参加）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES slots(id),
  FOREIGN KEY (attendee_id) REFERENCES entry_attendees(id) ON DELETE CASCADE,
  UNIQUE (entry_id, slot_id, attendee_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_slots_slot ON entry_slots(slot_id);
CREATE INDEX IF NOT EXISTS idx_entry_slots_entry ON entry_slots(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_slots_attendee ON entry_slots(attendee_id);

-- 日別チェックイン（両日参加者の Day1/Day2 別受付）
CREATE TABLE IF NOT EXISTS entry_checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  day TEXT NOT NULL,                            -- 'Day1' / 'Day2'
  checked_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  UNIQUE (entry_id, day)
);

CREATE INDEX IF NOT EXISTS idx_entry_checkins_entry ON entry_checkins(entry_id);

-- 監査ログ（管理操作の記録）
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  action TEXT NOT NULL,                         -- login / admin-cancel / checkin / export-csv 等
  target TEXT,                                  -- 対象（申込ID等）
  ip TEXT,
  ua TEXT,
  country TEXT,
  meta TEXT                                     -- 補足情報（JSON）
);

CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- 申込/キャンセルメールの送信ログ（Resend失敗時の追跡・手動再送用）
-- 軍神提案：リトライキュー（Cloudflare Queues 有料）を使わず、
-- このテーブルでログ管理→管理画面から手動再送
CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER,
  email_to TEXT NOT NULL,
  email_subject TEXT,
  email_type TEXT NOT NULL,                    -- 'applicant' / 'admin' / 'cancel'
  provider TEXT NOT NULL DEFAULT 'resend',     -- 'resend' / 'slack' / etc
  status TEXT NOT NULL,                        -- 'sent' / 'failed' / 'retry_pending'
  error_message TEXT,
  provider_message_id TEXT,                    -- ResendのメッセージID等
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_email_logs_entry ON email_logs(entry_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_created ON email_logs(created_at);

-- 一斉メール（email-blast）の送信履歴
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template TEXT,                               -- テンプレート種別（1週間前・前日・custom 等）
  filter TEXT,                                 -- 対象フィルタ（all/day1/day2/both）
  subject TEXT,
  body TEXT,
  target_count INTEGER,                        -- 対象件数
  success_count INTEGER,                       -- 送信成功
  failed_count INTEGER,                        -- 送信失敗
  testmode INTEGER NOT NULL DEFAULT 0,         -- 1=テスト送信
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at);

-- ============================================
-- ビュー：スロット残席（リアルタイム集計用）
-- ============================================
-- 【重要】キャンセルは entries.status='cancelled' に更新するだけで entry_slots 行は残すため、
-- reserved は「confirmed のみ」を数える必要がある。LEFT JOIN の結合条件に status を置き、
-- SUM は CASE WHEN e.id IS NOT NULL で confirmed 分だけ合計すること（2026-07-02 残席バグ修正）。
--   SELECT s.*, COALESCE(SUM(CASE WHEN e.id IS NOT NULL THEN es.attendees END), 0) AS reserved
--   FROM slots s
--   LEFT JOIN entry_slots es ON s.id = es.slot_id
--   LEFT JOIN entries e ON es.entry_id = e.id AND e.status = 'confirmed'
--   GROUP BY s.id
--   ORDER BY s.sort_order;
