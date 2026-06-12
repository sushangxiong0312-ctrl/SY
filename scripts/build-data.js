'use strict';
// 在 GitHub Actions 里运行：拉取本仓库全部 releases，生成 docs/data.json 供下载页读取。
// 不依赖任何第三方包，用 Node 内置 fetch（Node 18+）。
const fs = require('fs');

const repo = process.env.GITHUB_REPOSITORY; // owner/repo
const token = process.env.GITHUB_TOKEN;

async function main() {
  const cfg = JSON.parse(fs.readFileSync('site-config.json', 'utf8'));
  const mirrors = cfg.mirrors || [];

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
    .map((r) => ({
      version: r.tag_name,
      title: r.name || r.tag_name,
      date: r.published_at || r.created_at,
      prerelease: !!r.prerelease,
      body: r.body || '',
      files: (r.assets || []).map((a) => ({
        name: a.name,
        size: a.size,
        downloadCount: a.download_count,
        url: a.browser_download_url,
        mirrors: mirrors.map((m) => ({ name: m.name, url: m.prefix + a.browser_download_url })),
      })),
    }));

  const data = {
    site: cfg.site,
    subtitle: cfg.subtitle,
    repo,
    generatedAt: new Date().toISOString(),
    versions,
  };

  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/data.json', JSON.stringify(data, null, 2));
  console.log(`已生成 docs/data.json，版本数：${versions.length}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
