import { Client } from '@elastic/elasticsearch';
import dotenv from 'dotenv';
import { prisma } from '../config/prisma';

dotenv.config();

const ES_NODE = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';

export const esClient = new Client({
  node: ES_NODE,
  maxRetries: 3,
  requestTimeout: 3000,
});

const INDEX_NAME = 'emails';
let isESAvailable = false;

export async function initElasticsearch() {
  try {
    const ping = await esClient.ping();
    if (ping) {
      isESAvailable = true;
      console.log('✅ Connected to Elasticsearch node successfully');

      const exists = await esClient.indices.exists({ index: INDEX_NAME });
      if (!exists) {
        await esClient.indices.create({
          index: INDEX_NAME,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              subject: { type: 'text' },
              body: { type: 'text' },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              etherealPreviewUrl: { type: 'keyword' },
              senderId: { type: 'keyword' },
              userId: { type: 'keyword' },
              senderEmail: { type: 'keyword' },
              senderName: { type: 'text' },
              createdAt: { type: 'date' },
            }
          }
        });
        console.log(`✅ Elasticsearch index '${INDEX_NAME}' created`);
      }

      await esClient.indices.putMapping({
        index: INDEX_NAME,
        properties: { userId: { type: 'keyword' } },
      });

      const emails = await prisma.email.findMany({ include: { sender: true } });
      for (let offset = 0; offset < emails.length; offset += 500) {
        const operations = emails.slice(offset, offset + 500).flatMap((email) => [
          { index: { _index: INDEX_NAME, _id: email.id } },
          {
            id: email.id,
            recipient: email.recipient,
            subject: email.subject,
            body: email.body,
            status: email.status,
            scheduledAt: email.scheduledAt.toISOString(),
            sentAt: email.sentAt?.toISOString() || null,
            etherealPreviewUrl: email.etherealPreviewUrl,
            senderId: email.senderId,
            senderEmail: email.sender.email,
            senderName: email.sender.name,
            userId: email.userId || '',
            createdAt: email.createdAt.toISOString(),
          },
        ]);
        await esClient.bulk({ operations, refresh: false });
      }
    }
  } catch (error: any) {
    isESAvailable = false;
    console.warn(`⚠️ Elasticsearch not reachable at ${ES_NODE}. Operating with DB fallback search.`);
  }
}

export async function indexEmailDoc(email: any) {
  await indexEmailDocs([email]);
}

export async function indexEmailDocs(emails: any[]) {
  if (!isESAvailable) return;
  try {
    const operations = emails.flatMap((email) => [
      { index: { _index: INDEX_NAME, _id: email.id } },
      {
        id: email.id,
        recipient: email.recipient,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt ? new Date(email.scheduledAt).toISOString() : null,
        sentAt: email.sentAt ? new Date(email.sentAt).toISOString() : null,
        etherealPreviewUrl: email.etherealPreviewUrl || null,
        senderId: email.senderId,
        userId: email.userId || '',
        senderEmail: email.sender?.email || '',
        senderName: email.sender?.name || '',
        createdAt: new Date(email.createdAt).toISOString(),
      },
    ]);
    if (operations.length > 0) await esClient.bulk({ operations, refresh: false });
  } catch (error: any) {
    console.warn('⚠️ Error bulk-indexing email documents to Elasticsearch:', error.message);
  }
}

export async function searchEmails(params: {
  query?: string;
  status?: string;
  senderId?: string;
  userId: string;
  page?: number;
  limit?: number;
}) {
  const page = params.page || 1;
  const limit = params.limit || 20;
  const from = (page - 1) * limit;

  if (isESAvailable) {
    try {
      const mustClauses: any[] = [];
      
      if (params.query && params.query.trim() !== '') {
        mustClauses.push({
          multi_match: {
            query: params.query.trim(),
            fields: ['recipient^3', 'subject^2', 'body', 'senderEmail', 'senderName'],
            fuzziness: 'AUTO',
          }
        });
      }

      if (params.status && params.status !== 'ALL') {
        const statuses = params.status.split(',').filter(Boolean);
        mustClauses.push(statuses.length === 1
          ? { term: { status: statuses[0] } }
          : { terms: { status: statuses } });
      }

      if (params.senderId) {
        mustClauses.push({ term: { senderId: params.senderId } });
      }

      mustClauses.push({ term: { userId: params.userId } });

      const response = await esClient.search({
        index: INDEX_NAME,
        from,
        size: limit,
        query: mustClauses.length > 0 ? { bool: { must: mustClauses } } : { match_all: {} },
        sort: [{ scheduledAt: { order: 'desc' } }],
      });

      const hits = response.hits.hits.map((hit: any) => hit._source);
      const total = typeof response.hits.total === 'number' ? response.hits.total : response.hits.total?.value || 0;

      return {
        source: 'Elasticsearch',
        emails: hits,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) },
      };
    } catch (error: any) {
      console.warn('⚠️ Elasticsearch search error, switching to DB fallback:', error.message);
    }
  }

  // DB Fallback search
  const where: any = {};
  if (params.status && params.status !== 'ALL') {
    const statuses = params.status.split(',').filter(Boolean);
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }
  if (params.senderId) {
    where.senderId = params.senderId;
  }
  where.userId = params.userId;
  if (params.query && params.query.trim() !== '') {
    const q = params.query.trim();
    where.OR = [
      { recipient: { contains: q } },
      { subject: { contains: q } },
      { body: { contains: q } },
    ];
  }

  const [emails, total] = await Promise.all([
    prisma.email.findMany({
      where,
      include: { sender: true },
      orderBy: { scheduledAt: 'desc' },
      skip: from,
      take: limit,
    }),
    prisma.email.count({ where }),
  ]);

  return {
    source: 'PostgreSQL/SQLite DB',
    emails,
    pagination: { total, page, limit, pages: Math.ceil(total / limit) },
  };
}
