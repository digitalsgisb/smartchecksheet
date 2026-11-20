// Google Apps Script web-app links, including Google Workspace (/a/macros/<domain>/s/...) ones.
// The SDY1 Pi tracker checks the same shape (sdy1.py is_valid_web_app_url).
export const sheetsUrlPattern = /^https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]{1,100}|macros)\/s\/[A-Za-z0-9_-]{10,200}\/exec$/;
