import api from './api';

const userService = {
  register: async (payload) => (await api.post('/users/register', payload)).data,
  login: async (payload) => (await api.post('/users/login', payload)).data,
  getTransactions: async () => (await api.get('/transactions')).data,
};

export const { getTransactions } = userService;
export default userService;
