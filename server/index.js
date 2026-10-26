import { createApp } from './app.js';

const missing = ['GOONG_REST_KEY', 'GOONG_MAP_KEY', 'SERPAPI_KEY'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Thiếu cấu hình: ${missing.join(', ')}. Tạo file .env từ .env.example.`);
  process.exit(1);
}

const port = Number(process.env.PORT || 3210);
const app = createApp();

app.listen(port, '127.0.0.1', () => {
  console.log(`Điểm Hẹn đang chạy tại http://localhost:${port}`);
});
