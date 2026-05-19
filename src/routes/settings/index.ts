import { Router } from 'express';
import { getBootstrap, getIframe, postCreate, postUpdate } from './controller';

export const settingsRouter = Router();

settingsRouter.get('/iframe', getIframe);
settingsRouter.get('/bootstrap', getBootstrap);
settingsRouter.post('/create', postCreate);
settingsRouter.post('/update', postUpdate);
