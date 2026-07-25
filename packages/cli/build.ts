/**
 * CLI 构建脚本
 */

// 使用 Bun 的构建工具
Bun.spawn([
  'bun',
  'build',
  '--entry', './src/main.ts',
  '--outdir', './bin',
  '--target', 'bun',
  '--minify',
], {
  cwd: import.meta.dir,
  stdout: 'pipe',
  stderr: 'pipe',
}).exited.then((code) => {
  if (code === 0) {
    console.log('✅ CLI 构建成功!')
    process.exit(0)
  } else {
    console.error('❌ 构建失败')
    process.exit(1)
  }
})
