package repository

import (
	"context"
	"errors"
	"sync"

	"demo/gin-users-api/internal/domain"
)

var ErrNoRows = errors.New("sql: no rows in result set")

type UserRepository interface {
	Save(ctx context.Context, u *domain.User) error
	GetByID(ctx context.Context, id string) (*domain.User, error)
	GetByEmail(ctx context.Context, email string) (*domain.User, error)
	List(ctx context.Context, role string, offset, limit int) ([]*domain.User, int)
	Delete(ctx context.Context, id string) error
}

type memoryRepo struct {
	mu     sync.RWMutex
	byID   map[string]*domain.User
	byMail map[string]string
}

func NewMemoryRepository() UserRepository {
	return &memoryRepo{byID: map[string]*domain.User{}, byMail: map[string]string{}}
}

func (r *memoryRepo) Save(_ context.Context, u *domain.User) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.byID[u.ID] = u
	r.byMail[u.Email] = u.ID
	return nil
}

func (r *memoryRepo) GetByID(_ context.Context, id string) (*domain.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	u, ok := r.byID[id]
	if !ok {
		return nil, ErrNoRows
	}
	return u, nil
}

func (r *memoryRepo) GetByEmail(_ context.Context, email string) (*domain.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id, ok := r.byMail[email]
	if !ok {
		return nil, ErrNoRows
	}
	return r.byID[id], nil
}

func (r *memoryRepo) List(_ context.Context, role string, offset, limit int) ([]*domain.User, int) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	all := make([]*domain.User, 0, len(r.byID))
	for _, u := range r.byID {
		if role == "" || u.Role == role {
			all = append(all, u)
		}
	}
	for i := range all {
		for j := i + 1; j < len(all); j++ {
			if all[j].CreatedAt.Before(all[i].CreatedAt) {
				all[i], all[j] = all[j], all[i]
			}
		}
	}
	total := len(all)
	if offset > total {
		return []*domain.User{}, total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return all[offset:end], total
}

func (r *memoryRepo) Delete(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	u, ok := r.byID[id]
	if !ok {
		return ErrNoRows
	}
	delete(r.byMail, u.Email)
	delete(r.byID, id)
	return nil
}
