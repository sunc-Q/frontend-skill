package repository

import (
	"fmt"
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"etk/internal/domain"
)

// Open 使用纯 Go 的 glebarez/sqlite 驱动（无需 CGO）。
// DSN 打开 WAL、busy_timeout、外键与 immediate 事务锁；文件权限 0600。
func Open(path string) (*gorm.DB, error) {
	if err := os.MkdirAll(filepathDir(path), 0o755); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %w", err)
	}
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=txlock(immediate)"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, fmt.Errorf("打开 SQLite 失败: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, err
	}
	// 单写者模型：连接池压到 1，避免 SQLITE_BUSY。
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := db.AutoMigrate(&domain.Event{}, &domain.TicketType{}, &domain.Order{}, &domain.Ticket{}); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	return db, nil
}

// Harden 在首次写入后再压一遍权限：-wal/-shm 只在有写入后才出现，
// Open() 里 chmod 会漏掉它们（WAL 里是完整数据页）。
func Harden(path string) error {
	for _, suffix := range []string{"", "-wal", "-shm"} {
		f := path + suffix
		if _, err := os.Stat(f); err != nil {
			continue
		}
		if err := os.Chmod(f, 0o600); err != nil {
			return fmt.Errorf("收紧 %s 权限失败: %w", f, err)
		}
	}
	return nil
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
