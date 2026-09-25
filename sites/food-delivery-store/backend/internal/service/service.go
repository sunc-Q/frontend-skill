package service

import (
	"context"
	"strings"
	"unicode/utf8"

	"bizsite/internal/domain"
	"bizsite/internal/repository"
	"time"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) Menu(ctx context.Context, q domain.MenuQuery) ([]domain.MenuRow, int64, error) {
	return s.repo.Menu(ctx, q)
}

func (s *Service) Zones(ctx context.Context) ([]domain.Zone, error) {
	return s.repo.Zones(ctx, true)
}

func (s *Service) Stats(ctx context.Context) (*domain.Stats, error) {
	return s.repo.Stats(ctx)
}

func (s *Service) ListOrders(ctx context.Context, q domain.OrderListQuery) ([]domain.OrderRow, int64, error) {
	rows, total, err := s.repo.ListOrders(ctx, q)
	if err != nil {
		return nil, 0, err
	}
	for i := range rows {
		decorate(&rows[i])
	}
	return rows, total, nil
}

func (s *Service) OrderDetail(ctx context.Context, id int64) (*domain.OrderRow, []domain.OrderItem, error) {
	row, err := s.repo.OrderByID(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	items, err := s.repo.OrderItems(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	decorate(row)
	return row, items, nil
}

// decorate 是手机号脱敏与送达预估的唯一出口：raw phone 永远不出 service 层。
func decorate(row *domain.OrderRow) {
	row.MaskedPhone = domain.MaskPhone(row.Phone)
	row.Phone = ""
	row.EtaMinutes = row.PrepMinutes + row.ZoneEtaMin
}

var addrBlocked = []string{"<", ">", "`", "\x00", "\r", "\n", ";", "--", "/*"}

func (s *Service) PlaceOrder(ctx context.Context, in domain.PlaceOrderInput) (*domain.OrderRow, []domain.OrderItem, error) {
	in.Recipient = strings.TrimSpace(in.Recipient)
	in.Address = strings.TrimSpace(in.Address)
	in.Note = strings.TrimSpace(in.Note)
	if !utf8.ValidString(in.Recipient) || !utf8.ValidString(in.Address) || !utf8.ValidString(in.Note) {
		errs := map[string]string{"address": "包含非法字符"}
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	for _, bad := range addrBlocked {
		if strings.Contains(in.Address, bad) || strings.Contains(in.Recipient, bad) {
			errs := map[string]string{"address": "地址/姓名包含非法控制字符或注入片段"}
			return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
		}
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}

	zone, err := s.repo.ZoneByCode(ctx, in.ZoneCode)
	if err != nil {
		if err == domain.ErrNotFound {
			e := map[string]string{"zone": "配送区域不存在"}
			return nil, nil, domain.Field("invalid_request", "参数校验未通过", e)
		}
		return nil, nil, err
	}
	if !zone.Active {
		e := map[string]string{"zone": "该配送区域已停用"}
		return nil, nil, domain.Field("zone_inactive", "配送区域已停用", e)
	}

	codes := make([]string, 0, len(in.Items))
	for _, it := range in.Items {
		codes = append(codes, it.Code)
	}
	dishes, err := s.repo.DishesByCodes(ctx, codes)
	if err != nil {
		return nil, nil, err
	}
	found := map[string]*domain.Dish{}
	for i := range dishes {
		found[dishes[i].Code] = &dishes[i]
	}
	var subtotal int64
	var prep int
	var count int
	items := make([]domain.OrderItem, 0, len(in.Items))
	for _, it := range in.Items {
		d, exist := found[it.Code]
		if !exist {
			return nil, nil, domain.New("dish_not_found", "菜品 "+it.Code+" 不存在", 404)
		}
		if !d.Available {
			return nil, nil, domain.New("dish_unavailable", "菜品「"+d.Name+"」今日已售罄，请调整后重新下单", 409)
		}
		line := d.PriceCents * int64(it.Qty)
		subtotal += line
		prep += d.PrepMin * ((it.Qty + 1) / 2)
		count += it.Qty
		items = append(items, domain.OrderItem{
			DishCode: d.Code, DishName: d.Name, UnitPriceCents: d.PriceCents, Qty: it.Qty, LineCents: line,
		})
	}
	if subtotal < zone.MinOrderCents {
		return nil, nil, domain.New("below_min_order",
			"未满起送价：还差 "+yuanText(zone.MinOrderCents-subtotal)+"，"+zone.Name+" 起送 "+yuanText(zone.MinOrderCents), 409)
	}

	now := s.now()
	seq, err := s.DailySeq(ctx, now)
	if err != nil {
		return nil, nil, err
	}
	draft := &repository.PlaceOrderDraft{
		Order: domain.Order{
			OrderNo:          repository.FormatOrderNo(now, seq+1),
			Recipient:        in.Recipient,
			Phone:            in.Phone,
			ZoneCode:         zone.Code,
			Address:          in.Address,
			Note:             in.Note,
			Status:           domain.OrderPlaced,
			ItemCount:        count,
			SubtotalCents:    subtotal,
			DeliveryFeeCents: zone.FeeCents,
			TotalCents:       subtotal + zone.FeeCents, // 恒等式：实付 = 菜品小计 + 配送费
			PrepMinutes:      prep,
			PlacedAt:         now,
		},
		Items: items,
	}
	if err := s.repo.PlaceOrder(ctx, draft, now); err != nil {
		return nil, nil, err
	}
	return s.OrderDetail(ctx, draft.Order.ID)
}

func (s *Service) DailySeq(ctx context.Context, day time.Time) (int, error) {
	return s.repo.DailySeq(ctx, day)
}

func (s *Service) Advance(ctx context.Context, id int64, to string) (*domain.OrderRow, []domain.OrderItem, error) {
	if !domain.ValidStatus(to) {
		e := map[string]string{"to": "目标状态非法"}
		return nil, nil, domain.Field("invalid_request", "参数校验未通过", e)
	}
	row, err := s.repo.AdvanceOrder(ctx, id, to)
	if err != nil {
		return nil, nil, err
	}
	items, err := s.repo.OrderItems(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	decorate(row)
	return row, items, nil
}

func (s *Service) SetAvailability(ctx context.Context, id int64, available bool) (*domain.Dish, error) {
	return s.repo.SetAvailability(ctx, id, available)
}

func yuanText(cents int64) string {
	yuan := cents / 100
	fen := cents % 100
	if fen == 0 {
		return "¥" + itoa64(yuan)
	}
	return "¥" + itoa64(yuan) + "." + itoa64(fen/10) + itoa64(fen%10)
}

func itoa64(n int64) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}
