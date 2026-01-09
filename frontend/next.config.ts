import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export', // 👈 这一行你应该原本就有
  
  // 🔥 新增这一行！非常关键！
  trailingSlash: true, 
  
  // 其他配置保持不变...
  images: {
    unoptimized: true,
  },
};

export default nextConfig;