package domain

import "errors"

// AppError 是唯一对外暴露的错误形态：Code/Message 可控，Err 只进日志，绝不回显给客户端。
type AppError struct {
	Code     string
	Message  string
	HTTPCode int
	Err      error
	Fields   map[string]string
}

func (e *AppError) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Err.Error()
	}
	return e.Code
}

func (e *AppError) Unwrap() error { return e.Err }

func New(code, message string, httpCode int) *AppError {
	return &AppError{Code: code, Message: message, HTTPCode: httpCode}
}

func Wrap(code, message string, httpCode int, err error) *AppError {
	return &AppError{Code: code, Message: message, HTTPCode: httpCode, Err: err}
}

func Field(code, message string, errs map[string]string) *AppError {
	return &AppError{Code: code, Message: message, HTTPCode: 400, Fields: errs}
}

var (
	ErrNotFound      = New("not_found", "资源不存在", 404)
	ErrUnauthorized  = New("unauthorized", "缺少或错误的管理令牌", 401)
	ErrForbidden     = New("forbidden", "无权执行该操作", 403)
	ErrInvalid       = New("invalid_request", "参数校验未通过", 400)
	ErrConflict      = New("conflict", "资源冲突", 409)
	ErrInternal      = New("internal_error", "服务内部错误，请稍后重试", 500)
	ErrUnreachable   = errors.New("unreachable")
	ErrTokenNotSetup = New("server_misconfigured", "服务端未配置管理令牌", 503)
)
