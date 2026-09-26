(function () {
  'use strict';
  var form = document.getElementById('sub-form');
  var input = document.getElementById('email');
  var status = document.getElementById('sub-status');
  var BLOCKED = ['mailinator.com', 'tempmail.cn'];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var done = [];
  function say(msg, kind) {
    status.textContent = msg;
    status.className = 'status ' + kind;
  }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var v = (input.value || '').trim().toLowerCase();
    if (!v) {
      say('请填写邮箱地址。', 'error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    if (!EMAIL_RE.test(v)) {
      say('格式不像有效邮箱，请检查拼写。', 'error');
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    input.removeAttribute('aria-invalid');
    var domain = v.slice(v.indexOf('@') + 1);
    if (BLOCKED.indexOf(domain) >= 0) {
      say('一次性邮箱域名（' + domain + '）不在接收范围。', 'error');
      return;
    }
    if (done.indexOf(v) >= 0) {
      say('这个地址在本次访问里已经订阅过了。', 'info');
      return;
    }
    done.push(v);
    say('已把 ' + v + ' 加入订阅名单（演示状态：未真实发送）。', 'ok');
    form.reset();
  });
})();
