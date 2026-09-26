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
// DSN 打开 WAL、busy_timeout、外键与 immediate 事务锁；库文件权限压到 0600（存司机手机号）。
func Open(path string) (*gorm.DB, error) {
	if err := os.MkdirAll(dirOf(path), 0o755); err != nil {
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
	// 单写者模型：连接池压到 1，避免 SQLITE_BUSY；事务闭包内一律用 tx，不得回头用 r.db。
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := db.AutoMigrate(&domain.Pile{}, &domain.Vehicle{}, &domain.TariffRule{}, &domain.ChargeSession{}); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	// 部分唯一索引：同一桩/同一车各只允许一条「未关闭」会话（在充或故障挂起）。
	// 单写者已保证串行，这层索引是放开多连接前的结构性兜底。
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pile_open ON charge_sessions (pile_id) WHERE status IN ('charging','faulted')`).Error; err != nil {
		return nil, fmt.Errorf("建立桩占用索引失败: %w", err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_open ON charge_sessions (vehicle_id) WHERE status IN ('charging','faulted')`).Error; err != nil {
		return nil, fmt.Errorf("建立车辆占用索引失败: %w", err)
	}
	if err := Harden(path); err != nil {
		return nil, err
	}
	return db, nil
}

// Harden 把库文件三件套压回 0600。-wal/-shm 只在首次写入后才出现，
// 所以种子灌完必须再调一次，否则库 0600 而 WAL 0644（WAL 里是完整数据页）。
func Harden(path string) error {
	for _, suffix := range []string{"", "-wal", "-shm"} {
		p := path + suffix
		if _, err := os.Stat(p); err != nil {
			continue
		}
		if err := os.Chmod(p, 0o600); err != nil {
			return fmt.Errorf("收紧 %s 权限失败: %w", p, err)
		}
	}
	return nil
}

func dirOf(p string) string {
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
