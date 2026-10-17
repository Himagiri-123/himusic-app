// Google Apps Script: lets the HiMusic server send OTP emails from YOUR Gmail (free, ~100 mails/day).
//
// 1. Go to https://script.google.com -> New project -> paste this whole file.
// 2. Project Settings (gear) -> Script properties -> Add property:  SECRET = any long random text.
// 3. Deploy -> New deployment -> type "Web app":  Execute as: Me,  Who has access: Anyone.  Authorize when asked.
// 4. Copy the Web app URL. On Render set:
//      MAIL_RELAY_URL    = that URL
//      MAIL_RELAY_SECRET = the same SECRET text
function doPost(e) {
  var d = JSON.parse(e.postData.contents);
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || d.secret !== secret) return ContentService.createTextOutput("forbidden");
  MailApp.sendEmail({ to: d.to, subject: d.subject, body: d.text, htmlBody: d.html, name: "HiMusic" });
  return ContentService.createTextOutput("ok");
}
