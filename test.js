// var 全局变量 ，let   const   


var a =1;

var a = "abc";


var a = 1 , b = 2

a>b
a<b
a = b

//a == b  判断 a 是否等于 b

//a === b  判断 a 是否等于 b (值和类型都相等)


if(a>b){
    console.log("a>b")
}else{
    console.log("a<b")
}


const a = [1,2,3]


for (let i = 0; i < a.length; i++) {
    console.log(a[i])
}
a.Protype.array

a.forEach(element => {
    
});

    for (const i of a) {
        console.log(i)
    }

    for (const i in a) {
        console.log(i)
    }

// 箭头函数

const a = (a,b)=>{
    // this  为 underfind
    return a+b
}

// 普通的函数说明
function a(a,b){
    // this  为 window
    return a+b
}


// const 是 常量  let 是 变量

const a ={
    userName:"123",
    age:18
}

Object.values(A).forEach(element => {
    console.log(element)
});

const a = [1,2,3,4,5];

// 添加元素
a.push(6)

// 删除元素
a.pop()

// 修改元素
a[0] = 0

// 查找元素

a.indexOf(1)

a.find(item=>{
    return item === 1
})

// 扩展方法
Array.prototype.find =function(cb){
    for(let i =0;i<this.length;i++){
        if(cb(this[i],i)){
            return this[i]
        }
    }
}

//this[i] 获取当前元素 i 索引


const a = [1,2,3,4,5];


// 删除元素
// splice(start, deleteCount) 直接操作数组
a.splice(0,1)

// filter(callback) 返回一个新数组
a.filter(item=>{
    return item !== 1
})


    // map reduce filter find  some every 

a.map(item=>{
    return item * 2
})

// 链式调用
a.map(item=>item +2)
.filter(item=>item > 4)
.reduce((acc,cur)=>acc+cur,0)

1,2,3,4,5

//acc  accumulator 累计器
//第一次循环
acc=0
current=1
return 1
//第二次循环
acc=1
current=2
return 3

const a = {
    name:'huangzhipeng',
    age:18,
    info:{
        hobby:'coding',
        age:18
    }
}

// 前端用new Map 存储数据

//js 


console.log(a.b);

//undefined

//常用
a.b

//? 可选链
a?.b ?? 'abc'
//?? 空值合并


if(a?.name){

}

//检测对象中是否有某个属性
if(Reflect.has(a,'name')){
    console.log(a.name);
}

//检测对象中是否有某个属性
if(Object.hasOwn(a,'name')){
    
}

//检测对象中属性值是否为空
if(Object.hasOwnProperty(a,"name")){

}



