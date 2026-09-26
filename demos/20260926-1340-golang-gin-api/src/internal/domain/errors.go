package domain

import "errors"

type AppError struct {
	Code    int
	Message string
	Err     error
}

func (e *AppError) Error() string { return e.Message }
func (e *AppError) Unwrap() error { return e.Err }

func (e *AppError) Is(target error) bool {
	t, ok := target.(*AppError)
	if ok {
		return e.Code == t.Code
	}
	return errors.Is(e.Err, target)
}

func (e *AppError) New(cause error) *AppError {
	return &AppError{Code: e.Code, Message: e.Message, Err: cause}
}

var (
	ErrNotFound   = &AppError{Code: 404, Message: "resource not found"}
	ErrConflict   = &AppError{Code: 409, Message: "resource already exists"}
	ErrValidation = &AppError{Code: 422, Message: "validation failed"}
	ErrInternal   = &AppError{Code: 500, Message: "internal server error"}
)
