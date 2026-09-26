package service

import (
	"context"
	"strings"
	"time"
	"unicode/utf8"

	"flea/internal/domain"
	"flea/internal/repository"
)

type Service struct {
	repo *repository.Repo
	now  func() time.Time
}

func New(repo *repository.Repo) *Service {
	return &Service{repo: repo, now: func() time.Time { return time.Now().UTC().Truncate(time.Second) }}
}

func (s *Service) Categories(ctx context.Context) ([]domain.Category, error) {
	return s.repo.Categories(ctx)
}

func (s *Service) Metrics(ctx context.Context, days int) (*domain.Metrics, error) {
	return s.repo.Metrics(ctx, days)
}

func (s *Service) Listings(ctx context.Context, q domain.ListQuery) ([]domain.ListingRow, int64, error) {
	return s.repo.ListListings(ctx, q)
}

func (s *Service) Deals(ctx context.Context, q domain.OfferQuery) ([]domain.OfferView, int64, error) {
	return s.repo.ListOffers(ctx, q)
}

// Detail：挂单本体 + 该单全部出价（金额降序）。
func (s *Service) Detail(ctx context.Context, code string) (*domain.ListingRow, []domain.OfferView, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if !domain.CodeAllowed(code) || len(code) > 24 {
		return nil, nil, domain.ErrInvalid
	}
	row, err := s.repo.ListingRowByCode(ctx, code)
	if err != nil {
		return nil, nil, err
	}
	offers, err := s.repo.OffersForListing(ctx, row.ID)
	if err != nil {
		return nil, nil, err
	}
	return row, offers, nil
}

// hasReplacementChar：Go 的 JSON 解码器会把非法 UTF-8（如裸 CESU-8 三字节序列）
// 静默替换成 U+FFFD 后照常入库。这里把它当脏输入拒掉，而不是让乱码进页面。
func hasReplacementChar(ss ...string) bool {
	for _, s := range ss {
		if strings.ContainsRune(s, utf8.RuneError) {
			return true
		}
	}
	return false
}

// CreateListing：卖家上架。编号唯一冲突返回 409，字段校验返回 400。
func (s *Service) CreateListing(ctx context.Context, in domain.CreateListingInput) (*domain.Listing, error) {
	in.Code = strings.ToUpper(strings.TrimSpace(in.Code))
	in.Title = strings.TrimSpace(in.Title)
	in.Seller = strings.TrimSpace(in.Seller)
	in.Area = strings.TrimSpace(in.Area)
	in.Category = strings.ToLower(strings.TrimSpace(in.Category))
	if hasReplacementChar(in.Title, in.Seller, in.Area, in.Code, in.Category) {
		return nil, domain.ErrInvalid
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	cat, err := s.repo.CategoryByCode(ctx, in.Category)
	if err != nil {
		if err == domain.ErrNotFound {
			errs := map[string]string{"category": "品类不存在"}
			return nil, domain.Field("invalid_request", "参数校验未通过", errs)
		}
		return nil, err
	}
	l := &domain.Listing{
		Code: in.Code, Title: in.Title, CategoryID: cat.ID, Seller: in.Seller,
		AskingCent: in.AskingCent, FloorCent: in.FloorCent, RefCent: cat.RefCent,
		Condition: in.Condition, Area: in.Area, Status: domain.ListingAvailable,
		PostedAt: s.now(),
	}
	if err := s.repo.CreateListing(ctx, l); err != nil {
		return nil, err
	}
	return l, nil
}

// PlaceOffer：买家出价。字段校验后把业务判定全部交给事务内的仓储层（状态机/保底/阶梯）。
func (s *Service) PlaceOffer(ctx context.Context, listingCode string, in domain.PlaceOfferInput) (*domain.Offer, error) {
	code := strings.ToUpper(strings.TrimSpace(listingCode))
	in.Buyer = strings.TrimSpace(in.Buyer)
	in.Message = strings.TrimSpace(in.Message)
	if !domain.CodeAllowed(code) || len(code) < 4 || len(code) > 24 {
		return nil, domain.ErrNotFound
	}
	errs, ok := in.Validate()
	if !ok {
		return nil, domain.Field("invalid_request", "参数校验未通过", errs)
	}
	if hasReplacementChar(in.Message, in.Buyer, listingCode) {
		return nil, domain.ErrInvalid
	}
	return s.repo.PlaceOffer(ctx, code, in.Buyer, in.AmountCent, in.Message, s.now())
}

// Decide：卖家对一笔出价做终审。单号唯一，所以只凭 deal_no 定位挂单。
// accept 把挂单转 reserved；reject 拒绝并保持挂单在拍。
func (s *Service) Decide(ctx context.Context, dealNo string, accept bool) (*domain.ListingRow, string, error) {
	dealNo = strings.ToUpper(strings.TrimSpace(dealNo))
	if len(dealNo) < 6 || len(dealNo) > 24 || !domain.CodeAllowed(dealNo) {
		return nil, "", domain.ErrInvalid
	}
	view, err := s.repo.OfferByDeal(ctx, dealNo)
	if err != nil {
		return nil, "", err
	}
	code, err := s.repo.ListingCodeByID(ctx, view.ListingID)
	if err != nil {
		return nil, "", err
	}
	if accept {
		l, err := s.repo.AcceptOffer(ctx, code, dealNo, s.now())
		if err != nil {
			return nil, "", err
		}
		row, err := s.repo.ListingRowByCode(ctx, l.Code)
		if err != nil {
			return nil, "", err
		}
		return row, "已确认成交，挂单转入待交付", nil
	}
	if err := s.repo.RejectOffer(ctx, code, dealNo, s.now()); err != nil {
		return nil, "", err
	}
	fresh, err := s.repo.OfferByDeal(ctx, dealNo)
	if err != nil {
		return nil, "", err
	}
	row, err := s.repo.ListingRowByCode(ctx, fresh.ListingCode)
	if err != nil {
		return nil, "", err
	}
	return row, "已拒绝该出价，挂单继续在拍", nil
}
