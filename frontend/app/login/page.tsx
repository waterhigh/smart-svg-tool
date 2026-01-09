'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useRouter } from 'next/navigation';
import Link from 'next/link'; // 👈 1. 引入这个组件

const { Title } = Typography;

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', values.email);
      formData.append('password', values.password);

      const res = await axios.post('/token', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const token = res.data.access_token;
      localStorage.setItem('smart_svg_token', token);
      
      message.success('登录成功！即将跳转...');
      
      setTimeout(() => {
        router.push('/');
      }, 1000);

    } catch (error: any) {
      console.error(error);
      message.error('登录失败：账号或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-96 shadow-xl">
        <div className="text-center mb-8">
          <Title level={3}>Smart SVG Tool</Title>
          <p className="text-gray-500">请登录以使用 AI 拆解功能</p>
        </div>

        <Form
          name="login"
          initialValues={{ remember: true }}
          onFinish={onFinish}
          size="large"
        >
          <Form.Item
            name="email"
            rules={[{ required: true, message: '请输入邮箱!' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="邮箱 (例如: admin@test.com)" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码!' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登录
            </Button>
          </Form.Item>
          
          <div className="text-center">
             {/* 👇 2. 修改这里：把 a 标签换成 Link 标签 */}
             <Link href="/register" className="text-blue-500 text-sm hover:text-blue-700">
                还没有账号？去注册
             </Link>
          </div>
        </Form>
      </Card>
    </div>
  );
}