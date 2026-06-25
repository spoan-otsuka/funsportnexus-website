-- ============================================
-- fun sport nexus 2026.12 申込システム データベーススキーマ
-- Cloudflare D1 (SQLite)
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
  qr_token TEXT UNIQUE,                        -- 当日受付QR用ユニーク値（将来拡張）
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
  checked_in_at TEXT,                          -- 当日受付チェックイン時刻（将来拡張）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_email ON entries(email);
CREATE INDEX IF NOT EXISTS idx_entries_status ON entries(status);
CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_entries_qr_token ON entries(qr_token);

-- メール送信ログ（Resend失敗時の追跡・再送用）
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

-- 申込×スロット（中間テーブル：1申込に対して複数スロット選択可能）
CREATE TABLE IF NOT EXISTS entry_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  slot_id INTEGER NOT NULL,
  attendees INTEGER NOT NULL DEFAULT 1,        -- そのスロットに何名参加
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
  FOREIGN KEY (slot_id) REFERENCES slots(id),
  UNIQUE (entry_id, slot_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_slots_slot ON entry_slots(slot_id);
CREATE INDEX IF NOT EXISTS idx_entry_slots_entry ON entry_slots(entry_id);

-- ============================================
-- ビュー：スロット残席（リアルタイム集計用）
-- ============================================
-- SELECT で使う：
--   SELECT s.*, COALESCE(SUM(es.attendees), 0) AS reserved
--   FROM slots s
--   LEFT JOIN entry_slots es ON s.id = es.slot_id
--   LEFT JOIN entries e ON es.entry_id = e.id AND e.status = 'confirmed'
--   GROUP BY s.id
--   ORDER BY s.sort_order;
