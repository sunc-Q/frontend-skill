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
// DSN 打开 WAL、busy_timeout、外键与 immediate 事务锁；库文件权限 0600。
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
	// 单写者模型：连接池压到 1，避免 SQLITE_BUSY；事务闭包内一律用 tx。
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	if err := db.AutoMigrate(
		&domain.Property{}, &domain.RoomType{}, &domain.RateDay{},
		&domain.Booking{}, &domain.BookingNight{},
	); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	// 房态查询全靠「某房型 + 区间重叠 + 是否占库存」，AutoMigrate 的标签只建了单列索引，
	// 这里补一条复合索引（占库存的状态由查询侧过滤，不做部分索引以免和状态机耦合）。
	stmts := []string{
		`CREATE INDEX IF NOT EXISTS idx_bookings_room_range ON bookings(room_code, check_in, check_out)`,
		`CREATE INDEX IF NOT EXISTS idx_nights_date ON booking_nights(date, units)`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			return nil, fmt.Errorf("创建索引失败: %w", err)
		}
	}
	// 库里存了客人手机号，落盘文件一律收紧到 0600（含 WAL/SHM 侧文件，忽略尚未生成的）。
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Chmod(path+suffix, 0o600); err != nil && !os.IsNotExist(err) {
			return nil, fmt.Errorf("收紧数据库权限失败: %w", err)
		}
	}
	return db, nil
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
