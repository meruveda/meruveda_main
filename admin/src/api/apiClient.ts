import { AxiosRequestConfig } from 'axios';
import axiosInstance from './axiosInstance';

export const apiClient = {
  get: async <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    const response = await axiosInstance.get(url, config);
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
  post: async <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
    const response = await axiosInstance.post(url, data, config);
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
  patch: async <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
    const response = await axiosInstance.patch(url, data, config);
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
  put: async <T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> => {
    const response = await axiosInstance.put(url, data, config);
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
  delete: async <T = any>(url: string, config?: AxiosRequestConfig): Promise<T> => {
    const response = await axiosInstance.delete(url, config);
    return response.data?.data !== undefined ? response.data.data : response.data;
  }
};
