'use strict';
// 在 GitHub Actions 里运行：拉取本仓库全部 releases，按发布说明里的分类标记给文件归类，
// 生成 docs/data.json 供下载页读取。无第三方依赖，用 Node 内置 fetch（Node 18+）。
const fs = require('fs');

const repo = process.env.GITHUB_REPOSITORY; // owner/repo
const token = process.env.GITHUB_TOKEN;

// 从发布说明里解析分类标记，返回 { fileNameToKey, cleanBody }
// 标记格式（HTML 注释，页面不显示）：
// <!-- 分类
// 驱动文件: a.zip, b.zip
// 程序文件: c.exe
// -->
function parseCategories(body, categories) {
  const result = { map: {}, cleanBody: body || '' };
  if (!body) return result;
  const m = body.match(/<!--\s*(?:分类|categories)([\s\S]*?)-->/i);
  if (!m) return result;
  const block = m[1];
  // 从干净正文里去掉整个注释块
  result.cleanBody = body.replace(m[0], '').replace(/\n{3,}/g, '\n\n').trim();

  // 类别名（用户写的）→ key
  const nameToKey = {};
  for (const c of categories) {
    for (const n of (c.names || [])) nameToKey[n.trim()] = c.key;
    nameToKey[c.key] = c.key;
  }

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.search(/[:：]/);
    if (idx < 0) continue;
    const catName = line.slice(0, idx).trim();
    const files = line.slice(idx + 1).split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
    const key = nameToKey[catName];
    if (!key) continue;
    for (const f of files) result.map[f] = key;
  }
  return result;
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync('site-config.json', 'utf8'));
  const mirrors = cfg.mirrors || [];
  const categories = cfg.categories || [];
  const validKeys = new Set(categories.map((c) => c.key));
  const fallback = validKeys.has('other') ? 'other' : (categories[categories.length - 1] || {}).key;

  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'sy-actions',
    },
  });
  if (!res.ok) throw new Error(`拉取 releases 失败：HTTP ${res.status}`);
  const releases = await res.json();

  const versions = releases
    .filter((r) => !r.draft)
    .map((r) => {
      const parsed = parseCategories(r.body || '', categories);
      return {
        version: r.tag_name,
        title: r.name || r.tag_name,
        date: r.published_at || r.created_at,
        prerelease: !!r.prerelease,
        body: parsed.cleanBody,
        files: (r.assets || []).map((a) => {
          let category = parsed.map[a.name];
          if (!category || !validKeys.has(category)) category = fallback;
          return {
            name: a.name,
            size: a.size,
            downloadCount: a.download_count,
            url: a.browser_download_url,
            category,
            mirrors: mirrors.map((m) => ({ name: m.name, url: m.prefix + a.browser_download_url })),
          };
        }),
      };
    });

  const data = {
    site: cfg.site,
    subtitle: cfg.subtitle,
    repo,
    generatedAt: new Date().toISOString(),
    categories: categories.map((c) => ({ key: c.key, label: c.label, bundle: !!c.bundle })),
    versions,
  };

  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/data.json', JSON.stringify(data, null, 2));
  console.log(`已生成 docs/data.json，版本数：${versions.length}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
