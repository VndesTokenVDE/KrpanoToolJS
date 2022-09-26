export enum EInputDataType {
    file,
    imageData,
}

export interface IOptions {
    inputData: ImageData | File;
    type: EInputDataType;
    imageWidth: number;
    imageHeight: number;
    panoWidth: number;
    faceName: string;
}

export interface ILevelConfig {
    level: number;
    size: number;
}

export interface ITiles {
    path: string;
    base64: string;
}

export type TTilesList = ITiles[]

export default class MakeTiles {

    public levelConfig: ILevelConfig[] = []
    readonly maxTileSize = 512

    private imageFile: File
    private imageData: ImageData
    private panoWidth: number = 0
    private imageWidth: number = 0
    private imageHeight: number = 0
    private faceName: string
    private format: string = 'jpg'
    private inputDataType: EInputDataType = EInputDataType.imageData

    // save the cut tile image
    public tiles: TTilesList = []

    constructor(options: IOptions) {
        this.inputDataType = options.type
        this.faceName = options.faceName
        this.panoWidth = options.panoWidth
        if (options.type === EInputDataType.file) {
            this.imageFile = options.inputData as File
        } else {
            this.imageData = options.inputData as ImageData
            this.imageWidth = options.imageWidth
            this.imageHeight = options.imageHeight
            this.analyzeImageLevel(this.panoWidth)
        }
    }

    private loadImage() {
        return new Promise(resolve => {
            const img = new Image()
            img.src = URL.createObjectURL(this.imageFile)
            img.onload = () => {
                const canvas = document.createElement('canvas') as HTMLCanvasElement
                const ctx: CanvasRenderingContext2D = canvas.getContext('2d')
                const {width, height} = img
                this.imageWidth = width
                this.imageHeight = height
                ctx.drawImage(img, 0, 0)
                this.imageData = ctx.getImageData(0, 0, width, height)
                this.analyzeImageLevel(this.panoWidth)
                resolve()
            }
        })
    }


    private analyzeImageLevel(panoWidth: number) {

        // 系数，瓦片图最高层级的尺寸 = 图片宽度 / 系数
        const coefficient = 3.125
        // 瓦片图最大尺寸
        const maxTileSize = 512
        // 瓦片图最小尺寸
        const minTileSize = 64

        // 调整层级的尺寸：控制 faceSize % 512 % 64 = 0
        function adjustLevelSize(inputLevelSize: number) {

            if (inputLevelSize % maxTileSize % minTileSize === 0) return inputLevelSize

            const lastTileSize = inputLevelSize % maxTileSize

            // 最后一行小于64则舍弃
            if (lastTileSize < minTileSize) {
                inputLevelSize -= lastTileSize
            } else {
                //  最后一行瓦片的余数（对64取余）
                const minRemainder = lastTileSize % minTileSize
                if (minRemainder !== 0) {
                    inputLevelSize = inputLevelSize - (minTileSize - minRemainder)
                }
            }
            return inputLevelSize
        }

        function getLevelConfig(panoSize): ILevelConfig[] {
            let count = 1
            let levels = []
            const minFaceSize = 640
            const topLevelSize = panoSize / coefficient

            // 最高层
            levels.push({
                level: count,
                size: adjustLevelSize(topLevelSize)
            })

            getNextLevelConfig(topLevelSize)

            // 递归获取子层级
            function getNextLevelConfig(topLevelSize) {
                const space = 2
                const nextLevelSize = topLevelSize / space
                if (nextLevelSize + minTileSize >= minFaceSize) {
                    count++
                    levels.push({
                        level: count,
                        size: adjustLevelSize(nextLevelSize)
                    })
                    getNextLevelConfig(nextLevelSize)
                }
            }

            // 层级转为正常从小到大
            levels = levels.map((item, index) => {
                item.level = levels.length - index
                return item
            })

            console.log('层级：', count, levels)
            return levels
        }

        this.levelConfig = getLevelConfig(panoWidth)

    }

    generateAsync(): Promise<TTilesList> {
        return new Promise(resolve => {
            if (this.inputDataType === EInputDataType.file) {
                this.loadImage().then(() => {
                    resolve(this.generate())
                })
            } else {
                resolve(this.generate())
            }
        })
    }

    generate(): TTilesList {
        const tempCanvas = document.createElement('canvas') as HTMLCanvasElement
        const tempCtx = tempCanvas.getContext('2d')

        this.levelConfig.forEach(level => {
            const rows: number = Math.ceil(level.size / this.maxTileSize)
            const cols: number = rows
            const lastRowWdith = level.size % this.maxTileSize
            const lastColHeight = lastRowWdith

            tempCanvas.width = this.imageData.width
            tempCanvas.height = this.imageData.height
            tempCtx.putImageData(this.imageData, 0, 0)
            tempCtx.scale(level.size / this.imageData.width, level.size / this.imageData.width)
            tempCtx.drawImage(tempCanvas, 0, 0)

            for (let col = 0; col < cols; col++) {
                for (let row = 0; row < rows; row++) {

                    const lastRowFlat = lastRowWdith && row === rows - 1
                    const lastColFlat = lastColHeight && col === cols - 1

                    const tilesCanvas = document.createElement('canvas') as HTMLCanvasElement
                    const tilesCtx = tilesCanvas.getContext('2d')
                    const sx = row * this.maxTileSize
                    const sy = col * this.maxTileSize
                    const sw = lastRowFlat ? lastRowWdith : this.maxTileSize
                    const sh = lastColFlat ? lastColHeight : this.maxTileSize
                    const imageData = tempCtx.getImageData(sx, sy, sw, sh)
                    tilesCanvas.width = sw
                    tilesCanvas.height = sh
                    tilesCtx.putImageData(imageData, 0, 0, 0, 0, sw, sh)

                    /**
                     * The naming rules I refer to Krpano
                     * fileName: 'l' + level + '_' + faceName + '_' + col + row + '.jpg'
                     * rootFolder: faceNmae
                     * levelFolder: 'l' + level
                     * columnName: col （start from 1）
                     * fullPath: rootFolder / levelFolder / columnName / fileName
                     */
                    const formatRow = this.formatNum(row + 1)
                    const formatCol = this.formatNum(col + 1)
                    const tileFileName = `l${level.level}_${this.faceName}_${formatCol}_${formatRow}.jpg`
                    const folderPath = `${this.faceName}/l${level.level}/${formatCol}/`
                    this.tiles.push({
                        path: folderPath + tileFileName,
                        base64: tilesCanvas.toDataURL('image/jpeg', '0.92'),
                    })
                }
            }
        })

        return this.tiles
    }

    generateThumbAsync(width = 240, height = 240) {
        return new Promise(resolve => {
            this.loadImage().then(() => {
                resolve(this.generateThumb(width, height))
            })
        })
    }

    generateThumb(width = 240, height = 240) {
        const canvas = document.createElement('canvas') as HTMLCanvasElement
        const ctx: CanvasRenderingContext2D = canvas.getContext('2d')
        canvas.width = this.imageWidth
        canvas.height = this.imageHeight
        ctx.putImageData(this.imageData, 0, 0)
        ctx.scale(width / this.imageWidth, height / this.imageHeight)
        ctx.drawImage(canvas, 0, 0)

        const tempCavans = document.createElement('canvas') as HTMLCanvasElement
        const tempCtx: CanvasRenderingContext2D = tempCavans.getContext('2d')
        tempCavans.width = width
        tempCavans.height = height
        tempCtx.putImageData(ctx.getImageData(0, 0, width, height), 0, 0)
        const imageUrl = tempCavans.toDataURL('image/jpeg', '0.92')

        canvas.remove()
        tempCavans.remove()
        return imageUrl
    }

    formatNum(cur: number): string {
        const max: number = Math.ceil(this.levelConfig[0].size / this.maxTileSize)
        const zeroCount = max.toString().length - cur.toString().length
        let zeroStr = ''
        for (let i = 0; i < zeroCount; i++) {
            zeroStr = zeroStr + '0'
        }
        return `${zeroStr}${cur}`
    }
}