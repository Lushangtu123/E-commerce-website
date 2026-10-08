import express from 'express';
import request from 'supertest';
import router from '../../routes/recommendation.routes';
import { getRecommendationsByBrowseHistory, getRelatedProducts, getGuessYouLike } from '../../services/recommendation.service';
jest.mock('../../services/recommendation.service', () => ({
  getRecommendationsByBrowseHistory: jest.fn(async () => []), getRelatedProducts: jest.fn(async () => []), getGuessYouLike: jest.fn(async () => []),
}));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => { req.userId = 7; next(); },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
const app = express(); app.use('/api/recommendations', router);
beforeEach(() => jest.clearAllMocks());
describe('recommendation query contracts', () => {
  test.each(['personalized', 'related/1', 'guess-you-like'])('%s defaults to 10 and accepts bounded quantities', async endpoint => {
    const service = endpoint === 'personalized' ? getRecommendationsByBrowseHistory : endpoint === 'related/1' ? getRelatedProducts : getGuessYouLike;
    for (const [query, expected] of [['', 10], ['?limit=1', 1], ['?limit=50', 50]] as const) {
      expect((await request(app).get(`/api/recommendations/${endpoint}${query}`)).status).toBe(200);
      expect(service).toHaveBeenLastCalledWith(endpoint === 'personalized' ? 7 : endpoint === 'related/1' ? 1 : null, expected);
    }
  });
  test.each(['personalized', 'related/1', 'guess-you-like'])('%s rejects malformed, repeated and unknown query fields before reading', async endpoint => {
    for (const query of ['limit=0', 'limit=-1', 'limit=51', 'limit=1junk', 'limit=1.9', 'limit=01', 'limit=', 'limit=banana',
      'limit=9007199254740993', 'limit=1&limit=2', 'other=1', 'limit[x]=1']) {
      expect((await request(app).get(`/api/recommendations/${endpoint}?${query}`)).status).toBe(400);
    }
    expect(getRecommendationsByBrowseHistory).not.toHaveBeenCalled(); expect(getRelatedProducts).not.toHaveBeenCalled(); expect(getGuessYouLike).not.toHaveBeenCalled();
  });
  test.each(['0', '-1', '1junk', '1.9', '01', 'banana', '2147483648', '9007199254740993'])('rejects related product path %s', async id => {
    expect((await request(app).get(`/api/recommendations/related/${id}`)).status).toBe(400);
    expect(getRelatedProducts).not.toHaveBeenCalled();
  });
  test('accepts the largest supported product ID without rounding it', async () => {
    expect((await request(app).get('/api/recommendations/related/2147483647')).status).toBe(200);
    expect(getRelatedProducts).toHaveBeenCalledWith(2147483647, 10);
  });
  test('a service outage remains a server error', async () => {
    jest.mocked(getRelatedProducts).mockRejectedValueOnce(new Error('Fixture outage'));
    expect((await request(app).get('/api/recommendations/related/1')).status).toBe(500);
  });
});
