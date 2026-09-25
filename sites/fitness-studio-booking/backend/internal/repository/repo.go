package repository

import (
	"context"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"bizsite/internal/domain"
)

type Repo struct {
	db *gorm.DB
}

func New(db *gorm.DB) *Repo { return &Repo{db: db} }

// sessionSelect 把课节 + 课程 + 实时占座计数一次取回，前端不再二次计算。
const sessionSelect = `s.*, c.code AS class_code, c.name AS class_name, c.category, c.coach,
	c.coach_level, c.duration_min, c.intensity, c.price_cents, c.capacity,
	COALESCE(b.confirmed, 0) AS confirmed, COALESCE(b.waitlist, 0) AS waitlist,
	c.capacity - COALESCE(b.confirmed, 0) AS remaining`

const bookingAggJoin = `LEFT JOIN (
	SELECT session_id,
		SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
		SUM(CASE WHEN status = 'waitlist' THEN 1 ELSE 0 END) AS waitlist
	FROM bookings GROUP BY session_id
) b ON b.session_id = s.id`

// sessionBase 里所有过滤条件都以占位参数下进 SQL；排序列来自 domain 白名单。
func (r *Repo) sessionBase(ctx context.Context, q domain.ListQuery, from, until time.Time) *gorm.DB {
	base := r.db.WithContext(ctx).Table("sessions AS s").
		Joins("JOIN classes c ON c.id = s.class_id").
		Joins(bookingAggJoin).
		Where("s.start_at >= ? AND s.start_at < ?", from, until)
	if q.Category != "" {
		base = base.Where("c.category = ?", q.Category)
	}
	if q.Coach != "" {
		base = base.Where("c.coach = ?", q.Coach)
	}
	if q.Level != "" {
		base = base.Where("c.coach_level = ?", q.Level)
	}
	if q.Status != "" {
		base = base.Where("s.status = ?", q.Status)
	}
	if q.Search != "" {
		like := "%" + escapeLike(q.Search) + "%"
		base = base.Where("(c.name LIKE ? ESCAPE '\\' OR c.coach LIKE ? ESCAPE '\\' OR s.room LIKE ? ESCAPE '\\')", like, like, like)
	}
	return base
}

func (r *Repo) ListSessions(ctx context.Context, q domain.ListQuery, from time.Time) ([]domain.SessionRow, int64, error) {
	until := from.AddDate(0, 0, q.Days)
	base := r.sessionBase(ctx, q, from, until)

	var total int64
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []domain.SessionRow
	err := base.Select(sessionSelect).
		Order(q.Sort + " " + strings.ToUpper(q.Dir) + ", s.id ASC").
		Limit(q.PageSize).Offset(q.Offset()).
		Scan(&rows).Error
	return rows, total, err
}

func (r *Repo) Session(ctx context.Context, id int64) (*domain.SessionRow, error) {
	var row domain.SessionRow
	err := r.db.WithContext(ctx).Table("sessions AS s").
		Select(sessionSelect).
		Joins("JOIN classes c ON c.id = s.class_id").
		Joins(bookingAggJoin).
		Where("s.id = ?", id).Scan(&row).Error
	if err != nil {
		return nil, err
	}
	if row.ID == 0 {
		return nil, domain.ErrNotFound
	}
	return &row, nil
}

// Roster 出场名单：先 confirmed，再 waitlist，最后是取消/未到。
func (r *Repo) Roster(ctx context.Context, sessionID int64, limit int) ([]domain.RosterEntry, error) {
	if limit <= 0 || limit > 60 {
		limit = 60
	}
	var out []domain.RosterEntry
	err := r.db.WithContext(ctx).Table("bookings AS b").
		Select(`b.id AS booking_id, m.id AS member_id, m.name, m.phone, m.card_type, m.credits,
			b.status, b.source, b.created_at`).
		Joins("JOIN members m ON m.id = b.member_id").
		Where("b.session_id = ?", sessionID).
		Order("CASE b.status WHEN 'confirmed' THEN 0 WHEN 'waitlist' THEN 1 ELSE 2 END, b.created_at ASC").
		Limit(limit).Scan(&out).Error
	return out, err
}

func (r *Repo) Classes(ctx context.Context) ([]domain.Class, error) {
	var out []domain.Class
	err := r.db.WithContext(ctx).Where("active = ?", true).Order("category asc, name asc").Find(&out).Error
	return out, err
}

func (r *Repo) MemberByID(ctx context.Context, id int64) (*domain.Member, error) {
	var m domain.Member
	err := r.db.WithContext(ctx).First(&m, id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func (r *Repo) MemberByPhone(ctx context.Context, phone string) (*domain.Member, error) {
	var m domain.Member
	err := r.db.WithContext(ctx).Where("phone = ?", normalizePhone(phone)).First(&m).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, domain.ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &m, nil
}

func normalizePhone(s string) string {
	return strings.Map(func(r rune) rune {
		if r == '-' || r == ' ' {
			return -1
		}
		return r
	}, strings.TrimSpace(s))
}

// ActiveMembers 取可以立即约课的会员（不限次数的卡），供前台与测试快速选人。
func (r *Repo) ActiveMembers(ctx context.Context, limit int) ([]domain.Member, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}
	var out []domain.Member
	err := r.db.WithContext(ctx).
		Where("active = ? AND card_type IN ?", true,
			[]string{domain.CardMonthly, domain.CardQuarterly, domain.CardAnnual}).
		Order("id asc").Limit(limit).Find(&out).Error
	return out, err
}

// BookResult 告诉调用方这笔预约落成了什么状态，以及扣了多少次卡。
type BookResult struct {
	Booking    domain.Booking
	Status     string
	CreditUsed bool
}

// CreateBooking 在一个事务里完成：定位课节 → 校验容量 → 查重 → 写预约 → 次卡扣减。
// 单写连接池（MaxOpenConns=1）+ txlock(immediate) 保证并发预约不会双双超卖。
func (r *Repo) CreateBooking(ctx context.Context, sessionID int64, in domain.CreateBookingInput, at time.Time) (*BookResult, error) {
	res := &BookResult{}
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var s domain.Session
		if err := tx.First(&s, sessionID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.ErrNotFound
			}
			return err
		}
		var c domain.Class
		if err := tx.First(&c, s.ClassID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return domain.New("class_missing", "课节所属课程已不存在", 409)
			}
			return err
		}
		if s.Status != domain.SessionOpen {
			return domain.New("session_not_open", "该课节已结课或已取消，无法预约", 409)
		}
		if s.StartAt.Before(at) {
			return domain.New("session_started", "课程已开始，不能补约", 409)
		}

		var m domain.Member
		switch {
		case in.MemberID > 0:
			if err := tx.First(&m, in.MemberID).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return domain.New("member_not_found", "会员不存在", 404)
				}
				return err
			}
		default:
			if err := tx.Where("phone = ?", normalizePhone(in.Phone)).First(&m).Error; err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return domain.New("member_not_found", "手机号未注册，请先建档", 404)
				}
				return err
			}
		}
		if !m.Active {
			return domain.New("member_inactive", "会员已停卡，不能预约", 403)
		}
		if m.ExpiresAt.Before(at) {
			return domain.New("card_expired", "会员卡已过期，请先续卡", 409)
		}

		var dup domain.Booking
		err := tx.Where("session_id = ? AND member_id = ? AND status IN ?", sessionID, m.ID,
			[]string{domain.BookingConfirmed, domain.BookingWaitlist}).First(&dup).Error
		if err == nil {
			return domain.New("duplicate_booking", "该会员在这节课已有有效预约", 409)
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}

		var confirmed int64
		if err := tx.Model(&domain.Booking{}).
			Where("session_id = ? AND status = ?", sessionID, domain.BookingConfirmed).
			Count(&confirmed).Error; err != nil {
			return err
		}
		status := domain.BookingConfirmed
		if int(confirmed) >= c.Capacity {
			if in.AllowWaitlist == nil || !*in.AllowWaitlist {
				return domain.New("session_full", "这节课已满座，如需排队请带上 allow_waitlist", 409)
			}
			status = domain.BookingWaitlist
		}

		// 只有坐下来的 confirmed 才扣次；候补不扣，避免排队失败白扣一次卡。
		payByCredit := status == domain.BookingConfirmed &&
			(m.CardType == domain.CardTenSession || m.CardType == domain.CardTrial)
		if payByCredit && m.Credits <= 0 {
			return domain.New("no_credits", "次卡余额不足，请先充值", 409)
		}

		b := domain.Booking{
			SessionID: sessionID, MemberID: m.ID, Status: status,
			Source: in.Source, CreatedAt: at,
		}
		if err := tx.Create(&b).Error; err != nil {
			if isUniqueErr(err) {
				return domain.Wrap("conflict", "预约冲突，请刷新后重试", 409, err)
			}
			return err
		}
		if payByCredit {
			if err := tx.Model(&domain.Member{}).Where("id = ?", m.ID).
				Updates(map[string]any{"credits": m.Credits - 1, "visits": m.Visits + 1}).Error; err != nil {
				return err
			}
			res.CreditUsed = true
		} else if status == domain.BookingConfirmed {
			if err := tx.Model(&domain.Member{}).Where("id = ?", m.ID).
				Update("visits", m.Visits+1).Error; err != nil {
				return err
			}
		}
		res.Booking = b
		res.Status = status
		return nil
	})
	if err != nil {
		return nil, err
	}
	return res, nil
}

func (r *Repo) CreateMember(ctx context.Context, m *domain.Member) error {
	err := r.db.WithContext(ctx).Create(m).Error
	if isUniqueErr(err) {
		return domain.Wrap("conflict", "该手机号已建档", 409, err)
	}
	return err
}

func isUniqueErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique") || strings.Contains(msg, "constraint failed")
}

func escapeLike(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "%", "\\%")
	return strings.ReplaceAll(s, "_", "\\_")
}
