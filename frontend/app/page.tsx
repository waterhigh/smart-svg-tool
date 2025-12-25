// frontend/src/app/page.tsx
'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { Layout, Upload, message, Card, Steps, Spin } from 'antd';
import { InboxOutlined, CloudUploadOutlined, ScissorOutlined, SelectOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';

// 动态引入编辑器组件 (禁用 SSR)
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
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 }); // 存储图片尺寸
  const [currentStep, setCurrentStep] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const props: UploadProps = {
    name: 'file',
    multiple: false,
    action: '/upload/',
    onChange(info) {
      const { status, response } = info.file;
      
      if (status === 'uploading') {
        setCurrentStep(1);
        setIsUploading(true);
      }
      
      if (status === 'done') {
        setIsUploading(false);
        message.success(`图片加载完成，AI 引擎已就绪！`);
        if (response) {
            // 拿到后端返回的原图信息
            setImageUrl(response.image_url);
            setImgDims({ w: response.image_width, h: response.image_height });
            setCurrentStep(2);
        }
      } else if (status === 'error') {
        setIsUploading(false);
        message.error(`${info.file.name} 上传失败。`);
        setCurrentStep(0);
      }
    },
    showUploadList: false,
  };

  return (
    <Layout className="min-h-screen bg-gray-50">
      <Header className="bg-white border-b border-gray-200 flex items-center justify-between px-8">
        <div className="flex items-center gap-2">
           <ScissorOutlined className="text-2xl text-blue-600"/>
           <span className="text-xl font-bold text-white">智能 PNG 拆解 (SAM版)</span>
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
            // 没上传时显示上传框
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
            // 上传后显示双屏编辑器
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