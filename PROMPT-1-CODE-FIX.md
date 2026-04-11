# Prompt 1：inkOS Bug 修复 + 版本升级 + Mac 打包

> 使用方式：把下面分隔线以下的全部内容复制到新的 Claude Code 会话里。
> 配套文件：/Users/admin/Codex/Project/inkOS/BUG-FIX-PLAN-ALL.md（必须和本 prompt 配合使用）

---

请按照 /Users/admin/Codex/Project/inkOS/BUG-FIX-PLAN-ALL.md 这份计划执行完整的 bug 修复。

严格按照 plan 执行，不要跳步，不要自作主张改动范围。

## 修复范围（共 5 个 bug）
- Bug A: provider.ts 的 isLikelyStreamError 400 误判
- Bug B: base.ts 的 chatWithSearch 无降级
- Bug C: provider.ts 的 sync 重试仍带 webSearch
- Bug D: provider.ts 的 SDK 解析错误提示
- Bug E: runner.ts 的 buildPersistenceOutput 补全 4 个 merge

## 必做项

1. 按 plan 的【预期修复】章节，精确修改以下 3 个源码文件：
   - /Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts
   - /Users/admin/Codex/Project/inkOS/packages/core/src/agents/base.ts
   - /Users/admin/Codex/Project/inkOS/packages/core/src/pipeline/runner.ts

2. 版本号同步更新 v0.2.2.5 → v0.2.2.6，必须改全 4 处硬编码：
   - /Users/admin/Codex/Project/inkOS/packages/studio/package.json (version 字段)
   - /Users/admin/Codex/Project/inkOS/packages/studio/server.cjs (STUDIO_VERSION 常量)
   - /Users/admin/Codex/Project/inkOS/packages/studio/public/js/about.js (version 字段 + 新增 changelog 条目，条目内容在 plan 里)
   - /Users/admin/Codex/Project/inkOS/packages/studio/installer.nsi (PRODUCT_VERSION)

3. 补测试用例（按 plan【测试计划】章节，**都是补充现有文件，不新建**）：
   - 补充 /Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/provider.test.ts
   - 补充 /Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/base-agent.test.ts
   - 补充 /Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/pipeline-runner.test.ts

   ## 测试实现的写死偏好（不要自由发挥）

   - **helper 代码一律内联到现有 3 个测试文件里，不要新建任何 helper 文件**（比如不要建 src/__tests__/__helpers__/）
   - **isLikelyStreamError 的可见性处理**：优先**直接 export** `isLikelyStreamError` 出去。不要设计 __test__ 包装层、不要加 internal 注释、不要用 eval 或其他 hack。如果 export 会和 TS 的 public API 约束冲突再说。
   - **buildPersistenceOutput 的可见性处理**：**绝对不要**把 `private` 改成 `protected` 或 package-private。测试里直接用 `(runner as any).buildPersistenceOutput(...)` 绕过 TS 类型检查。源文件可见性保持原样。
   - plan 的测试章节是断言清单描述，不是可粘贴的代码，需要你参考现有测试风格自己实现具体的 mock 和断言
   - 所有 mock 用 vi.spyOn / vi.mock 现场构造，不要抽公共 fixture

4. 编译 + 运行测试：
   ```bash
   cd /Users/admin/Codex/Project/inkOS/packages/core && npm run build
   cd /Users/admin/Codex/Project/inkOS/packages/core && npx vitest run
   ```

   **只有编译和测试都通过后才能进入第 5 步提交。如果任一失败，停下来报告。**

5. 提交（必须用 ‼️ 作为前缀，作为安全回退标记）：
   - 提交消息模板在 plan 的【阶段 5：提交】章节
   - 消息必须包含所有 5 个 bug 的简要说明 + 版本号变更说明 + 测试变更说明
   - 必须包含"⚠️ 本修复只止血，不会自动回填已丢失的历史数据"这一段

6. 推送到 papaintea 远程（不要推 origin，origin 没写权限）：
   ```bash
   cd /Users/admin/Codex/Project/inkOS && git push papaintea master
   ```

7. 重新打包 Mac 版本：
   ```bash
   cd /Users/admin/Codex/Project/inkOS/packages/studio && \
     npx pkg server.cjs --targets node18-macos-x64 --output dist/inkos-studio-mac && \
     node scripts/copy-dist-assets.cjs --mac && \
     bash scripts/build-mac-installer.sh
   ```

   产出物应包含：
   - /Users/admin/Codex/Project/inkOS/packages/studio/dist/InkOS-Studio-0.2.2.6-mac.dmg
   - /Users/admin/Codex/Project/inkOS/packages/studio/dist/InkOS-Studio-Setup-0.2.2.6-mac.pkg

   **如果打包失败：保留已提交的代码和已推送的 commit，不要 revert、不要 force push、不要 git reset。直接报告打包失败的原因，让用户决定是否继续或回滚。**

## 文件白名单（硬约束）

**本次任务只允许修改以下 10 个文件（3 个源码 + 4 个版本源 + 3 个测试），不允许改任何其他文件**：

源码（3 个）：
- /Users/admin/Codex/Project/inkOS/packages/core/src/llm/provider.ts
- /Users/admin/Codex/Project/inkOS/packages/core/src/agents/base.ts
- /Users/admin/Codex/Project/inkOS/packages/core/src/pipeline/runner.ts

版本源（4 个）：
- /Users/admin/Codex/Project/inkOS/packages/studio/package.json
- /Users/admin/Codex/Project/inkOS/packages/studio/server.cjs
- /Users/admin/Codex/Project/inkOS/packages/studio/public/js/about.js
- /Users/admin/Codex/Project/inkOS/packages/studio/installer.nsi

测试（3 个，都是补充）：
- /Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/provider.test.ts
- /Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/base-agent.test.ts
- /Users/admin/Codex/Project/inkOS/packages/core/src/__tests__/pipeline-runner.test.ts

除了这 10 个文件，不允许改任何其他文件。构建产出物（dist/ 下的文件）不在白名单约束内，打包时正常生成。

## 其他约束

- 不要改 plan 里标注"保持不变"的代码段
- 不要新建任何 helper 文件（测试 helper 一律内联到现有 3 个测试文件里）
- 不要改源文件的可见性修饰符（private / protected）去方便测试
- 不要触碰数据文件（~/.inkos/data/），本 prompt 只改代码和版本号
- 不要合并 origin/master 的任何内容
- 不要 force push
- 所有输出引用文件时必须使用绝对路径
- 编译或测试失败立刻停下报告
- 打包失败时保留已提交代码，不要回滚

## 报告

完成后请汇报：
- 修改了哪些文件（绝对路径）
- 补充了哪些测试文件（绝对路径）+ 每个文件补了哪些测试用例
- 编译结果和测试结果摘要
- commit hash
- push 结果
- 打包产出物路径和大小
- 如果打包失败：commit 已保留，请用户决定下一步
