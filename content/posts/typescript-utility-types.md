---
title: "手写 TypeScript 工具类型：从 Pick 到 DeepPartial"
date: "2025-08-28"
summary: "把内置工具类型拆开看看，顺便实现几个标准库里没有但很常用的。"
tags: ["TypeScript", "前端"]
---

TypeScript 的内置工具类型看起来很魔法，但拆开之后大多只有一两行。理解它们最好的方式就是自己实现一遍。

## 从三个基本构件说起

几乎所有工具类型都由这三样东西拼出来：

1. **映射类型** `{ [K in Keys]: T }`
2. **条件类型** `T extends U ? X : Y`
3. **`infer` 推断**

## Partial / Required / Readonly

```ts
type MyPartial<T> = { [K in keyof T]?: T[K] }
type MyRequired<T> = { [K in keyof T]-?: T[K] }
type MyReadonly<T> = { readonly [K in keyof T]: T[K] }
type MyMutable<T> = { -readonly [K in keyof T]: T[K] }
```

`-?` 和 `-readonly` 里的减号是「移除修饰符」，这是映射类型少有人用但很关键的语法。

## Pick / Omit / Exclude

```ts
type MyPick<T, K extends keyof T> = { [P in K]: T[P] }

type MyExclude<T, U> = T extends U ? never : T

type MyOmit<T, K extends PropertyKey> = MyPick<T, MyExclude<keyof T, K>>
```

注意 `MyExclude` 里的条件类型作用在**联合类型**上时会自动分发（distributive）：`'a' | 'b' extends 'a'` 并不是整体判断，而是逐个成员判断后再union起来。

## 用 infer 拆解函数与 Promise

```ts
type MyReturnType<T> = T extends (...args: never[]) => infer R ? R : never

type MyParameters<T> = T extends (...args: infer P) => unknown ? P : never

// 递归解开嵌套 Promise
type Awaited<T> = T extends Promise<infer U> ? Awaited<U> : T
```

## 标准库里没有，但你迟早会需要的

### DeepPartial

配置对象合并时的常客：

```ts
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T
```

小心：`T extends object` 对数组和函数也成立，严格一点的版本需要把它们排除掉。

### RequireAtLeastOne

「这几个字段至少填一个」——在 API 参数校验里非常实用：

```ts
type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
  Omit<T, Keys> & {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Omit<T, K>>
  }[Keys]

interface Query {
  id?: string
  slug?: string
  title?: string
}

type ValidQuery = RequireAtLeastOne<Query, 'id' | 'slug'>

const a: ValidQuery = { id: '1' }         // ✅
const b: ValidQuery = { slug: 'hello' }   // ✅
const c: ValidQuery = { title: 'x' }      // ❌ 必须有 id 或 slug
```

### 联合转交叉

利用函数参数的逆变位置：

```ts
type UnionToIntersection<U> =
  (U extends unknown ? (x: U) => void : never) extends (x: infer I) => void
    ? I
    : never

type R = UnionToIntersection<{ a: 1 } | { b: 2 }>
// => { a: 1 } & { b: 2 }
```

## 调试技巧：把类型「摊平」

复杂的交叉类型在 IDE 里悬浮显示时经常是一团 `A & B & C`，看不出最终形状。加一个 `Prettify`：

```ts
type Prettify<T> = { [K in keyof T]: T[K] } & {}

type Ugly = { a: string } & { b: number } & { c: boolean }
type Nice = Prettify<Ugly>
// 悬浮显示：{ a: string; b: number; c: boolean }
```

那个看似无意义的 `& {}` 会强制 TypeScript 重新求值这个映射类型，是社区里流传很广的一个小技巧。

## 别玩过头

类型体操很有意思，但生产代码里，**能被同事一眼看懂的类型才是好类型**。当一个类型需要写注释才能解释时，通常意味着应该换个更简单的数据结构。
