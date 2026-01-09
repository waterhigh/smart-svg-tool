'use client';

import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Layout, Upload, message, Card, Steps, Spin } from 'antd';
import { InboxOutlined, CloudUploadOutlined, ScissorOutlined, SelectOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { useRouter } from 'next/navigation';

// 动态引入编辑器组件
const SvgEditor = dynamic(() => import('./SvgEditor'), { 
  ssr: false,
  loading: () => (
    <div className="h-96 flex flex-col items-center justify-center gap-2">
      <Spin size="large" />
      <span className="text-gray-500">正在加载编辑器...</span>
    </div>
  )
});

const { Header, Content, Footer } = Layout;
const { Dragger } = Upload;

export default function Home() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [currentStep, setCurrentStep] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  
  // 🔐 认证状态管理
  const [token, setToken] = useState<string>('');
  const [isAuthChecking, setIsAuthChecking] = useState(true); // 👈 默认正在检查
  const router = useRouter();

  // 🛡️ 核心修复：权限检查逻辑
  useEffect(() => {
    // 确保只在客户端执行
    if (typeof window !== 'undefined') {
        const storedToken = localStorage.getItem('smart_svg_token');
        
        if (!storedToken) {
            // ❌ 如果没 Token：
            // 1. 不设置 isAuthChecking = false (保持 Loading 状态)
            // 2. 提示并立即跳转 (用 replace 防止回退循环)
            message.warning({ content: '请先登录', key: 'auth_check' }); // key避免重复弹窗
            window.location.href = '/login';
        } else {
            // ✅ 如果有 Token：
            setToken(storedToken);
            setIsAuthChecking(false); // 解除 Loading，显示主页
        }
    }
  }, [router]);

  const props: UploadProps = {
    name: 'file',
    multiple: false,
    action: '/upload/',
    headers: {
        Authorization: `Bearer ${token}`
    },
    onChange(info) {
      const { status, response, error } = info.file;
      
      if (status === 'uploading') {
        setCurrentStep(1);
        setIsUploading(true);
      }
      
      if (status === 'done') {
        setIsUploading(false);
        message.success(`图片加载完成，AI 引擎已就绪！`);
        if (response) {
            setImageUrl(response.image_url);
            setImgDims({ w: response.image_width, h: response.image_height });
            setCurrentStep(2);
        }
      } else if (status === 'error') {
        setIsUploading(false);
        // 如果是 401，说明 Token 过期
        if (error?.status === 401) {
            message.error('登录已过期，请重新登录');
            localStorage.removeItem('smart_svg_token'); // 清除无效 Token
            router.replace('/login');
        } else {
            message.error(`${info.file.name} 上传失败。`);
        }
        setCurrentStep(0);
      }
    },
    showUploadList: false,
  };

  // ⏳ 如果正在检查权限，只显示全屏 Loading
  // 这能彻底防止"主页闪烁"和"重复弹窗"
  if (isAuthChecking) {
      return (
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
              <Spin size="large" tip="正在验证身份..." />
          </div>
      );
  }

  // 🚀 只有通过检查，才会渲染下面的真实页面
  return (
    <Layout className="min-h-screen bg-gray-50">
      <Header className="bg-white border-b border-gray-200 flex items-center justify-between px-8">
        <div className="flex items-center gap-2">
           <ScissorOutlined className="text-2xl text-blue-600"/>
           <span className="text-xl font-bold text-white">智能 PNG 拆解 (SAM版)</span>
        </div>
        
        {/* 退出按钮 */}
        <div 
            className="text-gray-500 cursor-pointer hover:text-red-500 transition-colors"
            onClick={() => {
                localStorage.removeItem('smart_svg_token');
                message.success('已退出登录');
                router.replace('/login');
            }}
        >
            退出登录
        </div>
      </Header>

      <Content className="p-8 max-w-[1400px] mx-auto w-full">
        <Steps 
          current={currentStep}
          className="mb-8"
          items={[
            { title: '上传图片', icon: <CloudUploadOutlined /> },
            { title: 'AI 预处理', icon: <ScissorOutlined /> },
            { title: '点击拆解', icon: <SelectOutlined /> },
          ]}
        />

        {!imageUrl ? (
            <Card title="上传原始图片" className="shadow-md rounded-xl h-96">
                <Spin spinning={isUploading} tip="正在上传并计算 Embeddings (大图可能需要十几秒)...">
                    <Dragger {...props} className="h-full" disabled={isUploading}>
                        <p className="ant-upload-drag-icon">
                        <InboxOutlined className="text-blue-500 text-6xl" />
                        </p>
                        <p className="ant-upload-text text-xl">点击或拖拽 PNG/JPG 图片到这里</p>
                        <p className="ant-upload-hint">
                            首次运行后端需要加载 SAM 模型，可能需要等待 30 秒左右。
                        </p>
                    </Dragger>
                </Spin>
            </Card>
        ) : (
            <SvgEditor 
                imageUrl={imageUrl} 
                imageWidth={imgDims.w} 
                imageHeight={imgDims.h} 
            />
        )}
      </Content>
      
      <Footer className="text-center text-gray-400">
        ©2025 Smart SVG Tool - Powered by SAM & VTracer
      </Footer>
    </Layout>
  );
}