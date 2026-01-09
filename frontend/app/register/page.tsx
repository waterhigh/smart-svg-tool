'use client';

import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons';
import axios from 'axios';
import { useRouter } from 'next/navigation';

const { Title } = Typography;

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const onFinish = async (values: any) => {
    // 1. 简单的客户端校验
    if (values.password !== values.confirm) {
        message.error('两次输入的密码不一致！');
        return;
    }

    setLoading(true);
    try {
      // 2. 调用后端注册接口
      // 注意：这里发送的是 JSON 格式，因为后端 /users/ 接收的是 Pydantic 模型
      await axios.post('/users/', {
          email: values.email,
          password: values.password
      });

      message.success('注册成功！请登录');
      
      // 3. 跳转去登录页
      setTimeout(() => {
        router.push('/login');
      }, 1000);

    } catch (error: any) {
      console.error(error);
      // 获取后端返回的具体错误 (比如 "Email already registered")
      const errorMsg = error.response?.data?.detail || '注册失败，请稍后重试';
      message.error(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <Card className="w-96 shadow-xl">
        <div className="text-center mb-6">
          <Title level={3}>创建账号</Title>
          <p className="text-gray-500">注册 Smart SVG Tool</p>
        </div>

        <Form
          name="register"
          onFinish={onFinish}
          size="large"
          scrollToFirstError
        >
          {/* 邮箱 */}
          <Form.Item
            name="email"
            rules={[
              { type: 'email', message: '请输入有效的邮箱格式!' },
              { required: true, message: '请输入邮箱!' },
            ]}
          >
            <Input prefix={<MailOutlined />} placeholder="邮箱地址" />
          </Form.Item>

          {/* 密码 */}
          <Form.Item
            name="password"
            rules={[
              { required: true, message: '请输入密码!' },
              { min: 6, message: '密码至少 6 位' }
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="设置密码" />
          </Form.Item>

          {/* 确认密码 */}
          <Form.Item
            name="confirm"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码!' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次密码输入不一致!'));
                },
              }),
            ]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="确认密码" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" block loading={loading}>
              立即注册
            </Button>
          </Form.Item>
          
          <div className="text-center">
             <a href="/login" className="text-blue-500 text-sm">已有账号？去登录</a>
          </div>
        </Form>
      </Card>
    </div>
  );
}