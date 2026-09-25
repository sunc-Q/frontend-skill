package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"bizsite/internal/domain"
	"bizsite/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC() }}
}

func (s *Service) ListProducts(ctx context.Context, q domain.ListQuery) ([]domain.ProductRow, int64, error) {
	return s.repo.ListProducts(ctx, q)
}

func (s *Service) Meta(ctx context.Context) (*repository.CatalogStats, error) {
	return s.repo.Stats(ctx)
}

// Detail 一次取回商品行、评分汇总与最新 5 条评价。
func (s *Service) Detail(ctx context.Context, sku string) (*domain.ProductRow, *domain.ReviewSummary, []domain.Review, error) {
	row, err := s.repo.ProductBySKU(ctx, sku)
	if err != nil {
		return nil, nil, nil, err
	}
	stats, err := s.repo.ReviewStats(ctx, row.ID)
	if err != nil {
		return nil, nil, nil, err
	}
	reviews, _, err := s.repo.Reviews(ctx, row.ID, 5, 0)
	if err != nil {
		return nil, nil, nil, err
	}
	return row, stats, reviews, nil
}

func (s *Service) Reviews(ctx context.Context, sku string, limit, offset int) ([]domain.Review, int64, error) {
	row, err := s.repo.ProductBySKU(ctx, sku)
	if err != nil {
		return nil, 0, err
	}
	return s.repo.Reviews(ctx, row.ID, limit, offset)
}

// AddToCart 校验并覆盖某 SKU 数量，返回最新购物车（默认目的国 US）。
func (s *Service) AddToCart(ctx context.Context, sku string, qty int, region string) (*domain.CartView, error) {
	sku = strings.TrimSpace(sku)
	if !utf8.ValidString(sku) || strings.ContainsAny(sku, "'\"\\;") {
		return nil, domain.ErrInvalid
	}
	in := domain.AddToCartInput{SKU: sku, Qty: qty}
	if errs, ok := in.Validate(); !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if _, err := s.repo.SetCartItem(ctx, sku, qty, s.now()); err != nil {
		return nil, err
	}
	return s.Cart(ctx, region)
}

// Cart 汇总购物车并为全部目的国一次性折算税费与总到手价。
func (s *Service) Cart(ctx context.Context, region string) (*domain.CartView, error) {
	region = strings.ToUpper(strings.TrimSpace(region))
	if region == "" {
		region = "US"
	}
	if domain.RegionByCode(region) == nil {
		return nil, domain.New("invalid_region", "目的国代码不在支持列表内", 400)
	}
	lines, err := s.repo.Cart(ctx)
	if err != nil {
		return nil, err
	}
	if lines == nil {
		lines = []domain.CartLine{}
	}
	var goods, weight int64
	qty := 0
	for _, l := range lines {
		if !l.Listed {
			continue // 已下架行不计价，仅提示
		}
		goods += l.LineCents
		weight += int64(l.WeightG) * int64(l.Qty)
		qty += l.Qty
	}
	totals := make([]domain.RegionTotal, 0, len(domain.Regions))
	for _, rg := range domain.Regions {
		freight := rg.FreightCents(int(weight))
		free := goods >= rg.FreeShipFrom && goods > 0
		if free {
			freight = 0
		}
		duty := goods * int64(rg.DutyPct) / 100
		totals = append(totals, domain.RegionTotal{
			Region:       rg,
			GoodsCents:   goods,
			FreightCents: freight,
			DutyCents:    duty,
			TotalCents:   goods + freight + duty,
			FreeShip:     free,
		})
	}
	return &domain.CartView{
		Lines:        lines,
		ItemQty:      qty,
		TotalWeightG: int(weight),
		Region:       region,
		Totals:       totals,
		ServedAt:     s.now().Format(time.RFC3339),
	}, nil
}

var skuAllowed = func(r rune) bool {
	return r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-'
}

// CreateProduct 是运营侧上新：SKU 字符集白名单 + 全字段边界校验，冲突 409。
func (s *Service) CreateProduct(ctx context.Context, in domain.CreateProductInput) (*domain.Product, error) {
	in.SKU = strings.TrimSpace(in.SKU)
	in.Name = strings.TrimSpace(in.Name)
	if !utf8.ValidString(in.SKU) || !utf8.ValidString(in.Name) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if strings.IndexFunc(in.SKU, func(r rune) bool { return !skuAllowed(r) }) >= 0 {
		errs := map[string]string{"sku": "SKU 只允许字母、数字、下划线与连字符"}
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	p := &domain.Product{
		SKU: in.SKU, Name: in.Name, NameEn: strings.TrimSpace(in.NameEn),
		Category: in.Category, Brand: strings.TrimSpace(in.Brand),
		PriceCents: in.PriceCents, Stock: in.Stock, WeightG: in.WeightG,
		HSCode: strings.ReplaceAll(in.HSCode, ".", ""), Origin: strings.TrimSpace(in.Origin),
		LeadMin: in.LeadMin, LeadMax: in.LeadMax, Sold30: 0,
		Listed: true, CreatedAt: s.now(),
	}
	if err := s.repo.CreateProduct(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}
