import {
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { s3Client, type StoredObject } from "./objectStorage";

const ACL_POLICY_METADATA_KEY = "acl-policy";

export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

// Stored as S3 user metadata under "x-amz-meta-acl-policy" (JSON string).
export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup {
  switch (group.type) {
    default:
      throw new Error(`Unknown access group type: ${group.type}`);
  }
}

export async function setObjectAclPolicy(
  objectFile: StoredObject,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  // S3 user metadata can only be set during PUT or COPY. To update metadata on
  // an existing object we copy it onto itself with REPLACE directive.
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: objectFile.bucket,
      Key: objectFile.key,
      CopySource: `${objectFile.bucket}/${encodeURIComponent(objectFile.key)}`,
      Metadata: {
        [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
      },
      MetadataDirective: "REPLACE",
    }),
  );
}

export async function getObjectAclPolicy(
  objectFile: StoredObject,
): Promise<ObjectAclPolicy | null> {
  const result = await s3Client.send(
    new HeadObjectCommand({ Bucket: objectFile.bucket, Key: objectFile.key }),
  );
  const raw = result.Metadata?.[ACL_POLICY_METADATA_KEY];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ObjectAclPolicy;
  } catch {
    return null;
  }
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: StoredObject;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) return false;

  if (
    aclPolicy.visibility === "public" &&
    requestedPermission === ObjectPermission.READ
  ) {
    return true;
  }

  if (!userId) return false;
  if (aclPolicy.owner === userId) return true;

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule.group);
    if (
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}
