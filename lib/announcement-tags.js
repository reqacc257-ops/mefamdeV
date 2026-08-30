function normalizeAnnouncementTag(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  const withoutEmoji = raw.replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\s]+/gu, '').trim();
  const cleaned = withoutEmoji.replace(/[\u2000-\u206F\u2E00-\u2E7F\\'"`]/g, '').trim();
  return cleaned.toLowerCase();
}

function displayAnnouncementTag(value) {
  const normalized = normalizeAnnouncementTag(value);
  const tagMap = {
    important: '📅 Important',
    academic: '🎓 Academic',
    applications: '📋 Applications',
    formation: '🕊️ Formation',
    finance: '💰 Finance',
    general: '📢 General',
  };

  if (tagMap[normalized]) return tagMap[normalized];
  const fallback = String(value || '').trim();
  return fallback || '📢 General';
}

module.exports = { normalizeAnnouncementTag, displayAnnouncementTag };
