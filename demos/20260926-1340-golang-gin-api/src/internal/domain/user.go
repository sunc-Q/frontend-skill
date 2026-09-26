package domain

import "time"

// Domain entity carries no json/binding tags per the skill's clean-arch note,
// but this skill's own SKILL.md shows tags on the entity; DTOs are kept separate below.
type User struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
}

type CreateUserRequest struct {
	Name     string `json:"name"     binding:"required,min=2,max=100"`
	Email    string `json:"email"    binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
	Role     string `json:"role"     binding:"omitempty,oneof=admin user"`
}

type ListQuery struct {
	Page  int    `form:"page"  binding:"omitempty,min=1"`
	Limit int    `form:"limit" binding:"omitempty,min=1,max=100"`
	Role  string `form:"role"  binding:"omitempty,oneof=admin user"`
}
