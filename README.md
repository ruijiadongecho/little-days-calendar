# 小小日常 · 家庭日历

一个适配 desktop 和 mobile 的 day view 日历网站。妈妈和女儿在自己的设备上登录同一个家庭账号，共同查看和编辑日记。

## 日历功能

- 月历与周日期条，按天查看和切换
- 每天饮水量：500ml、1000ml、1500ml、1500ml 以上
- 每天的睡觉时间
- 蛋白质、青菜、主食勾选
- 跳舞、走路勾选
- 可添加、删除当天的作业与实习投递
- 编程题数量加减
- 手机、平板和 desktop 自适应布局
- Supabase 邮箱注册/登录、云端保存和实时同步

## 启用云端同步

跨设备同步需要 Supabase 项目和一个可从两台设备访问的 HTTPS 网站地址。前端、数据库安全策略和单账号多设备登录流程都已准备好。

1. 创建 Supabase 项目，在 SQL Editor 运行 `supabase/schema.sql`。
2. 把 Supabase 项目 URL 和 publishable key 填进 `config.js` 的 `supabaseUrl` 和 `supabasePublishableKey`。这是浏览器端公开 key；不要使用或公开 secret key。
3. 将网站部署到 HTTPS 地址。
4. 在一个设备上打开网站，注册账号并创建一次家庭日历。
5. 在另一台设备打开同一个网址，使用相同的邮箱和密码登录即可。无需邀请码或第二个账号。

注册可能需要邮箱确认。两台设备共享同一登录凭据，因此系统按同一个账号保存记录，无法区分具体是哪台设备或哪位家人修改了记录。

数据库会启用行级安全策略，只有登录家庭账号才能访问相关家庭记录。Supabase 的 publishable key 可以放在前端；secret key 会绕过安全策略，绝不能放在网站里。

## 使用 GitHub Pages 发布

仓库根目录就是本网站文件夹。`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新时自动发布。

1. 在 GitHub 新建仓库，把本目录中的网站文件放到仓库根目录。
2. 在仓库 **Settings → Pages** 中把发布来源设为 **GitHub Actions**。
3. 推送到 `main` 后，在仓库的 **Actions** 中查看发布任务；成功后 GitHub Pages 会提供网站地址。
4. 在 Supabase **Authentication → URL Configuration** 中，把这个地址设为 Site URL，并加入允许的 Redirect URLs。
5. 先注册并确认家庭账号，然后两台设备登录同一账号。之后可在 Supabase Auth 设置中关闭新用户注册。

GitHub Pages 页面可通过互联网访问；GitHub Free 账户的 Pages 仓库需要公开。访客可看到网站和登录页面，但家庭日记由 Supabase 登录和 RLS 规则保护。源码中的 publishable key 是公开客户端密钥；secret key 不得放进仓库。

## 本机预览

如果 `config.js` 中两个 Supabase 配置留空，网站以本机预览模式启动，示例记录保存在当前浏览器的 `localStorage`；该模式不会与另一台设备同步。

```sh
python3 -m http.server 8000
```

打开 `http://localhost:8000` 即可预览本机页面。跨设备使用则需完成上面的云端配置并部署网站。
