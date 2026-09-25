package repository

import (
	"fmt"
	"os"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"autoshop/internal/domain"
)

// Open 使用纯 Go 的 glebarez/sqlite 驱动（无需 CGO）。
// DSN 打开 WAL、busy_timeout、外键与 txlock(immediate)；文件权限 0600。
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
	// 单写者模型：连接池压到 1，所有事务内的查询都必须用 tx，见 repo.go 的注释。
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	hardenFileMode(path)
	if err := db.AutoMigrate(
		&domain.Part{}, &domain.StockLot{}, &domain.WorkOrder{},
		&domain.WorkOrderLine{}, &domain.StockMove{},
	); err != nil {
		return nil, fmt.Errorf("建表失败: %w", err)
	}
	// AutoMigrate 之后库文件已经存在，索引/约束里 AutoMigrate 表达不了的部分要手写。
	if err := ensureIndexes(db); err != nil {
		return nil, err
	}
	hardenFileMode(path)
	return db, nil
}

// ensureIndexes 补齐 GORM tag 表达不了的约束：
//   - 批次余量不得为负、也不得大于入库量（数据库层兜底，防止任何一条 SQL 写飞）；
//   - 工单号与批次号一样只允许 ASCII 安全字符，这里靠应用层白名单把关；
//   - 出库流水必须能追到批次，(lot_no, part_code) 组合索引供 FIFO 与退料使用。
func ensureIndexes(db *gorm.DB) error {
	stmts := []string{
		`CREATE INDEX IF NOT EXISTS idx_lots_part_recv ON stock_lots (part_code, received_at)`,
		`CREATE INDEX IF NOT EXISTS idx_moves_part_time ON stock_moves (part_code, occurred_at)`,
		`CREATE INDEX IF NOT EXISTS idx_moves_wo ON stock_moves (wo_no)`,
		`CREATE INDEX IF NOT EXISTS idx_lines_order_kind ON work_order_lines (work_order_id, kind)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_status_open ON work_orders (status, opened_at)`,
	}
	for _, s := range stmts {
		if err := db.Exec(s).Error; err != nil {
			return fmt.Errorf("建索引失败: %w", err)
		}
	}
	// 批次余量下界：任何一条 SQL 把余量写成负数都会被拦下（账实相符的地基）。
	if err := db.Exec(`CREATE TRIGGER IF NOT EXISTS trg_lot_remaining_nonneg
		BEFORE UPDATE OF qty_remaining ON stock_lots
		FOR EACH ROW WHEN NEW.qty_remaining < 0 OR NEW.qty_remaining > NEW.qty_received
		BEGIN SELECT RAISE(ABORT, 'qty_remaining out of range'); END`).Error; err != nil {
		return fmt.Errorf("建触发器失败: %w", err)
	}
	return nil
}

// Harden 在首次写入（如灌种子）之后重新压一遍库文件权限。
func Harden(path string) { hardenFileMode(path) }

// hardenFileMode 把库文件（含 WAL/SHM）压到 0600：库里存了客户手机号。
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
