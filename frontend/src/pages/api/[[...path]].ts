import type { NextApiRequest, NextApiResponse } from 'next';

// Keep the existing Express routes and transaction service in the same deployment.
const handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void> =
  process.env.ECOMMERCE_SERVERLESS_API === 'true'
    ? require('../../../../backend/dist/serverless').default
    : async (_req, res) => { res.status(503).json({ error: '请使用已配置的独立后端 API' }); };

export const config = { api: { bodyParser: false, externalResolver: true }, maxDuration: 60 };
export default handler;
