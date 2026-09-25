package repository

import (
	"fmt"
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"libdesk/internal/domain"
)

// Open 使用纯 Go 的 glebarez/sqlite 驱动（无需 CGO）。
// DSN 打开 WAL、busy_timeout 与外键约束；文件权限 0600。
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
	hardenFileMode(path)
	if err := db.AutoMigrate(&domain.Item{}, &domain.Copy{}, &domain.Member{}, &domain.Loan{}); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	hardenFileMode(path)
	return db, nil
}

// Harden 在首次写入（如灌种子）之后重新压一遍库文件权限。
func Harden(path string) { hardenFileMode(path) }

// hardenFileMode 把库文件（含 WAL/SHM）压到 0600：库里存了读者联系方式。
// WAL/SHM 可能要到首次写入后才出现，因此 Seed 之后还要再调一次（见 Harden）。
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
