import apiClient from './client';

export async function sendForgotPasswordCode(username: string, email: string): Promise<{ message: string; expire_at?: string | null }> {
    const res = await apiClient.post<{ message: string; expire_at?: string | null }>('/api/v1/auth/password/forgot/send-code', {
        username,
        email,
    });
    return res.data;
}

export async function resetForgottenPassword(payload: {
    username: string;
    email: string;
    code: string;
    new_password: string;
}): Promise<{ message: string }> {
    const res = await apiClient.post<{ message: string }>('/api/v1/auth/password/forgot/reset', payload);
    return res.data;
}
