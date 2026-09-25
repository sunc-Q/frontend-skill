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
	if err := db.AutoMigrate(
		&domain.Assessment{}, &domain.Question{}, &domain.Attempt{}, &domain.AttemptAnswer{},
	); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	// 一个手机号在同一场测评里只能有一份「有效」作答；作废卷不占位，允许重考。
	// 这是部分唯一索引，AutoMigrate 表达不了，只能建表后补。
	stmt := `CREATE UNIQUE INDEX IF NOT EXISTS idx_attempts_active_phone
	        ON attempts(assessment_id, phone) WHERE status <> 'invalid'`
	if err := db.Exec(stmt).Error; err != nil {
		return nil, fmt.Errorf("创建唯一索引失败: %w", err)
	}
	// 库里存了考生手机号，落盘文件一律收紧到 0600（含 WAL/SHM 侧文件，忽略尚未生成的）。
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Chmod(path+suffix, 0o600); err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("收紧数据库权限失败: %w", err)
		}
	}
	return db, nil
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
