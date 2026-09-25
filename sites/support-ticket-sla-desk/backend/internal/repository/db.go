package repository

import (
	"fmt"
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"bizsite/internal/domain"
)

// Open 使用纯 Go 的 glebarez/sqlite 驱动（无需 CGO）。
// DSN 打开 WAL、busy_timeout、外键与 txlock(immediate)；文件权限 0600（库里存了客户联系人手机号）。
func Open(path string) (*gorm.DB, error) {
	if err := os.MkdirAll(filepathDir(path), 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger:               logger.Default.LogMode(logger.Silent),
		DisableAutomaticPing: false,
	})
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// 单写者模型：连接池压到 1。因此事务闭包内的一切查询都必须用 tx，
	// 用 r.db 会去抢这条已被独占的连接并直接死锁（第 5 轮的代价最大的坑）。
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)

	if err := db.AutoMigrate(
		&domain.Customer{}, &domain.Agent{}, &domain.SlaPolicy{},
		&domain.Ticket{}, &domain.TicketEvent{},
	); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	for _, stmt := range extraDDL {
		if err := db.Exec(stmt).Error; err != nil {
			return nil, fmt.Errorf("建立索引失败: %w", err)
		}
	}
	hardenFileMode(path)
	return db, nil
}

// extraDDL 是 tag 表达不了的索引：复合排序索引与「部分唯一索引」。
var extraDDL = []string{
	"CREATE INDEX IF NOT EXISTS idx_events_ticket_at ON ticket_events (ticket_id, at)",
	"CREATE INDEX IF NOT EXISTS idx_tickets_agent_status ON tickets (agent_id, status)",
	"CREATE INDEX IF NOT EXISTS idx_tickets_due_open ON tickets (resolve_due_at) WHERE status IN ('new','assigned','in_progress','pending_customer')",
	"CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_title_dedupe ON tickets (customer_id, title) WHERE status IN ('new','assigned','in_progress','pending_customer')",
}

// hardenFileMode 把库文件（含 WAL/SHM）压到 0600。WAL 文件可能在首次写入后才出现，
// 因此 Seed 之后还要再调一次。
func hardenFileMode(path string) {
	for _, p := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(p); err == nil {
			_ = os.Chmod(p, 0o600)
		}
	}
}

func filepathDir(p string) string {
	for i := len(p) - 1; i >= 0; i-- {
		if p[i] == '/' {
			if i == 0 {
				return "/"
			}
			return p[:i]
		}
	}
	return "."
}
